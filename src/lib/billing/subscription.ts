import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { PLANS, type Plan, type PlanId } from "./plans";

export interface SubscriptionRecord {
  userId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: PlanId;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

interface Row {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: number;
}

/** Stripe statuses that entitle a user to Pro. */
const ENTITLING_STATUSES = new Set(["active", "trialing"]);

function toRecord(row: Row): SubscriptionRecord {
  return {
    userId: row.user_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    plan: row.plan === "pro" ? "pro" : "free",
    status: row.status,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
  };
}

export function getSubscription(userId: string): SubscriptionRecord | null {
  const row = getDb()
    .prepare("SELECT * FROM subscriptions WHERE user_id = ?")
    .get(userId) as Row | undefined;
  return row ? toRecord(row) : null;
}

/**
 * The plan a user is actually entitled to right now.
 *
 * Pro is granted only when Stripe told us the subscription is active or
 * trialing AND the period we were told about has not already elapsed. A stale
 * row can therefore never keep someone on Pro indefinitely - if a webhook is
 * missed, entitlement lapses on its own at the period end.
 */
export function getEntitlement(userId: string): { plan: Plan; subscription: SubscriptionRecord | null } {
  const subscription = getSubscription(userId);
  if (!subscription || subscription.plan !== "pro") {
    return { plan: PLANS.free, subscription };
  }
  if (!ENTITLING_STATUSES.has(subscription.status)) {
    return { plan: PLANS.free, subscription };
  }
  if (subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd).getTime() < Date.now()) {
    return { plan: PLANS.free, subscription };
  }
  return { plan: PLANS.pro, subscription };
}

interface UpsertInput {
  userId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  plan?: PlanId;
  status?: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
}

/** Inserts or updates a user's billing row, leaving unspecified fields alone. */
export function upsertSubscription(input: UpsertInput): void {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getSubscription(input.userId);

  const next = {
    stripeCustomerId: input.stripeCustomerId ?? existing?.stripeCustomerId ?? null,
    stripeSubscriptionId: input.stripeSubscriptionId ?? existing?.stripeSubscriptionId ?? null,
    plan: input.plan ?? existing?.plan ?? "free",
    status: input.status ?? existing?.status ?? "inactive",
    currentPeriodStart:
      input.currentPeriodStart !== undefined
        ? input.currentPeriodStart
        : (existing?.currentPeriodStart ?? null),
    currentPeriodEnd:
      input.currentPeriodEnd !== undefined ? input.currentPeriodEnd : (existing?.currentPeriodEnd ?? null),
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? existing?.cancelAtPeriodEnd ?? false,
  };

  db.prepare(
    `INSERT INTO subscriptions
       (user_id, stripe_customer_id, stripe_subscription_id, plan, status,
        current_period_start, current_period_end, cancel_at_period_end, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       stripe_customer_id     = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id,
       plan                   = excluded.plan,
       status                 = excluded.status,
       current_period_start   = excluded.current_period_start,
       current_period_end     = excluded.current_period_end,
       cancel_at_period_end   = excluded.cancel_at_period_end,
       updated_at             = excluded.updated_at`,
  ).run(
    input.userId,
    next.stripeCustomerId,
    next.stripeSubscriptionId,
    next.plan,
    next.status,
    next.currentPeriodStart,
    next.currentPeriodEnd,
    next.cancelAtPeriodEnd ? 1 : 0,
    now,
  );
}

/** Finds the user a Stripe customer belongs to, for webhooks that only carry an id. */
export function findUserByCustomerId(customerId: string): string | null {
  const row = getDb()
    .prepare("SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?")
    .get(customerId) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

/**
 * The billing period lives on the subscription item in current API versions,
 * with the top-level fields kept for older ones.
 */
function periodIso(
  subscription: Stripe.Subscription,
  edge: "current_period_start" | "current_period_end",
): string | null {
  const item = subscription.items?.data?.[0] as unknown as Record<string, unknown> | undefined;
  const seconds =
    (item?.[edge] as number | undefined) ??
    (subscription as unknown as Record<string, number | undefined>)[edge];
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;
}

/**
 * Applies a Stripe subscription object to our own state. This is the only place
 * that decides someone is on Pro, and it decides it from Stripe's data.
 */
export function applyStripeSubscription(userId: string, subscription: Stripe.Subscription): void {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;

  upsertSubscription({
    userId,
    stripeCustomerId: customerId ?? null,
    stripeSubscriptionId: subscription.id,
    plan: ENTITLING_STATUSES.has(subscription.status) ? "pro" : "free",
    status: subscription.status,
    currentPeriodStart: periodIso(subscription, "current_period_start"),
    currentPeriodEnd: periodIso(subscription, "current_period_end"),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
  });
}

/** Records a webhook event id. Returns false when it was already applied. */
export function claimBillingEvent(id: string, type: string): boolean {
  try {
    getDb()
      .prepare("INSERT INTO billing_events (id, type, processed_at) VALUES (?, ?, ?)")
      .run(id, type, new Date().toISOString());
    return true;
  } catch {
    return false; // PRIMARY KEY conflict: a duplicate delivery.
  }
}

/**
 * Releases a claimed event id so a failed apply can be retried. Without this a
 * transient failure would permanently mark the event as handled and Stripe's
 * redelivery would be skipped as a duplicate.
 */
export function releaseBillingEvent(id: string): void {
  getDb().prepare("DELETE FROM billing_events WHERE id = ?").run(id);
}
