import { getDb } from "@/lib/db";
import type { ScanOwner } from "@/lib/scans";
import { METERED_SCAN_TYPE, PLANS, type Plan } from "./plans";
import { getEntitlement } from "./subscription";

/**
 * Usage is counted from the scans table itself rather than a separate counter,
 * so the number a user sees can never drift from the scans they actually have.
 * A scan is only ever persisted after the analysis succeeded, so failed and
 * rejected attempts are not charged against the quota.
 */

export interface UsageSummary {
  plan: Plan;
  used: number;
  limit: number;
  remaining: number;
  /** ISO timestamp when the allowance resets. */
  periodEnd: string;
  /** True when the next screenshot analysis would exceed the plan. */
  exhausted: boolean;
}

/** Allowances run on the calendar month, in UTC. */
export function currentPeriod(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

function countScans(owner: ScanOwner, since: string): number {
  const db = getDb();
  if (owner.userId) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM scans
          WHERE user_id = ? AND scan_type = ? AND created_at >= ?`,
      )
      .get(owner.userId, METERED_SCAN_TYPE, since) as { n: number };
    return Number(row.n);
  }
  if (owner.guestId) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM scans
          WHERE user_id IS NULL AND guest_id = ? AND scan_type = ? AND created_at >= ?`,
      )
      .get(owner.guestId, METERED_SCAN_TYPE, since) as { n: number };
    return Number(row.n);
  }
  return 0;
}

/**
 * Current usage for whoever is making the request. Signed-out visitors get the
 * Free allowance tracked against their guest id.
 */
export function getUsage(owner: ScanOwner): UsageSummary {
  const plan = owner.userId ? getEntitlement(owner.userId).plan : PLANS.free;
  const period = currentPeriod();
  const used = countScans(owner, period.start);
  const remaining = Math.max(0, plan.monthlyScans - used);

  return {
    plan,
    used,
    limit: plan.monthlyScans,
    remaining,
    periodEnd: period.end,
    exhausted: remaining <= 0,
  };
}

/** Human-readable reset date, e.g. "1 October". */
export function formatResetDate(periodEnd: string): string {
  return new Date(periodEnd).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
