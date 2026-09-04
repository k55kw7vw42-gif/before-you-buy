import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import type { ScanOwner } from "@/lib/scans";
import { METERED_SCAN_TYPE, PLANS, type Plan } from "./plans";
import { getEntitlement } from "./subscription";

/**
 * Usage is counted from the scans table itself rather than a running counter,
 * so the number a user sees can never drift from the scans they actually have.
 * A scan row is only written once the analysis succeeded, so failed and
 * rejected attempts are not charged.
 *
 * Counting completed scans alone is not enough to *enforce* a limit, though: an
 * analysis takes seconds, and two requests that both check before either writes
 * would both be allowed. So an in-flight request first claims a reservation,
 * and the allowance is spent by completed scans plus live reservations.
 */

/**
 * How long a reservation is honoured before it is treated as abandoned. It only
 * has to outlast one analysis; the ceiling matters if a process dies mid-request,
 * because until it lapses that slot stays spent.
 */
const RESERVATION_TTL_MS = 5 * 60 * 1000;

export type PeriodBasis = "billing" | "calendar";

export interface UsagePeriod {
  start: string;
  end: string;
  /**
   * "billing" - the subscriber's own Stripe period. "calendar" - the UTC
   * calendar month, used for everyone without an active subscription.
   */
  basis: PeriodBasis;
}

export interface UsageSummary {
  plan: Plan;
  used: number;
  limit: number;
  remaining: number;
  period: UsagePeriod;
  /** ISO timestamp when the allowance resets. */
  periodEnd: string;
  /** True when the next screenshot analysis would exceed the plan. */
  exhausted: boolean;
}

/** The UTC calendar month containing `now`. */
export function calendarMonth(now = new Date()): UsagePeriod {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString(), basis: "calendar" };
}

function ownerKey(owner: ScanOwner): string | null {
  if (owner.userId) return `user:${owner.userId}`;
  if (owner.guestId) return `guest:${owner.guestId}`;
  return null;
}

/**
 * Which window the allowance is measured over.
 *
 * A subscriber's allowance follows the period Stripe is billing them for, not
 * the calendar. Otherwise someone subscribing on the 28th would get a full
 * month's analyses for the last few days of that month and another full
 * month's on the 1st - two allowances for one payment.
 *
 * Everyone else has no billing period, so the calendar month is used.
 */
export function resolvePeriod(owner: ScanOwner, now = new Date()): UsagePeriod {
  if (!owner.userId) return calendarMonth(now);

  const { plan, subscription } = getEntitlement(owner.userId);
  if (plan.id !== "pro" || !subscription?.currentPeriodStart || !subscription.currentPeriodEnd) {
    return calendarMonth(now);
  }

  // Only trust the stored period while `now` actually falls inside it; a period
  // we were told about but which has since elapsed is no basis for an allowance.
  const startMs = new Date(subscription.currentPeriodStart).getTime();
  const endMs = new Date(subscription.currentPeriodEnd).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || nowMs < startMs || nowMs >= endMs) {
    return calendarMonth(now);
  }

  return {
    start: subscription.currentPeriodStart,
    end: subscription.currentPeriodEnd,
    basis: "billing",
  };
}

function countScans(owner: ScanOwner, period: UsagePeriod): number {
  const db = getDb();
  if (owner.userId) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM scans
          WHERE user_id = ? AND scan_type = ? AND created_at >= ? AND created_at < ?`,
      )
      .get(owner.userId, METERED_SCAN_TYPE, period.start, period.end) as { n: number };
    return Number(row.n);
  }
  if (owner.guestId) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM scans
          WHERE user_id IS NULL AND guest_id = ? AND scan_type = ?
            AND created_at >= ? AND created_at < ?`,
      )
      .get(owner.guestId, METERED_SCAN_TYPE, period.start, period.end) as { n: number };
    return Number(row.n);
  }
  return 0;
}

function countReservations(key: string, period: UsagePeriod, nowIso: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM scan_reservations
        WHERE owner_key = ? AND period_start = ? AND expires_at > ?`,
    )
    .get(key, period.start, nowIso) as { n: number };
  return Number(row.n);
}

/** Drops reservations that have lapsed, so a dead request cannot hold a slot forever. */
function purgeExpiredReservations(nowIso: string): void {
  getDb().prepare("DELETE FROM scan_reservations WHERE expires_at <= ?").run(nowIso);
}

function summarise(owner: ScanOwner, plan: Plan, period: UsagePeriod, now: Date): UsageSummary {
  const key = ownerKey(owner);
  const nowIso = now.toISOString();
  const used =
    countScans(owner, period) + (key ? countReservations(key, period, nowIso) : 0);
  const remaining = Math.max(0, plan.monthlyScans - used);

  return {
    plan,
    used,
    limit: plan.monthlyScans,
    remaining,
    period,
    periodEnd: period.end,
    exhausted: remaining <= 0,
  };
}

/**
 * Current usage for whoever is making the request. Signed-out visitors get the
 * Free allowance tracked against their guest id.
 */
export function getUsage(owner: ScanOwner, now = new Date()): UsageSummary {
  const plan = owner.userId ? getEntitlement(owner.userId).plan : PLANS.free;
  return summarise(owner, plan, resolvePeriod(owner, now), now);
}

export type Reservation =
  | { allowed: true; id: string; usage: UsageSummary }
  | { allowed: false; usage: UsageSummary };

/**
 * Claims one slot against the allowance, or refuses.
 *
 * The count and the insert run inside a single IMMEDIATE transaction, which
 * takes SQLite's write lock up front. Two requests racing here are serialised:
 * the second sees the first's reservation and is refused, so a limit cannot be
 * exceeded by timing the requests together.
 *
 * Every granted reservation must be released - see `releaseScanSlot`.
 */
export function reserveScanSlot(owner: ScanOwner, now = new Date()): Reservation {
  const plan = owner.userId ? getEntitlement(owner.userId).plan : PLANS.free;
  const period = resolvePeriod(owner, now);
  const key = ownerKey(owner);
  const db = getDb();

  db.exec("BEGIN IMMEDIATE");
  try {
    const nowIso = now.toISOString();
    purgeExpiredReservations(nowIso);

    const usage = summarise(owner, plan, period, now);
    if (usage.exhausted || !key) {
      db.exec("COMMIT");
      return { allowed: false, usage };
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO scan_reservations (id, owner_key, period_start, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, key, period.start, nowIso, new Date(now.getTime() + RESERVATION_TTL_MS).toISOString());
    db.exec("COMMIT");

    // The reservation itself is one of the used slots from here on.
    return {
      allowed: true,
      id,
      usage: { ...usage, used: usage.used + 1, remaining: Math.max(0, usage.remaining - 1) },
    };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Gives a claimed slot back. Call this once the scan row has been written (the
 * scan now counts in its place) or once the attempt has failed (nothing should
 * be charged). Safe to call more than once.
 */
export function releaseScanSlot(id: string): void {
  getDb().prepare("DELETE FROM scan_reservations WHERE id = ?").run(id);
}

/**
 * How to refer to the current allowance window in copy: a subscriber's window
 * is their billing period, everyone else's is the calendar month.
 */
export function periodLabel(period: UsagePeriod): string {
  return period.basis === "billing" ? "this billing period" : "this month";
}

/** Human-readable reset date, e.g. "1 October". */
export function formatResetDate(periodEnd: string): string {
  return new Date(periodEnd).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
