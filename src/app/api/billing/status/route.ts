import { NextResponse } from "next/server";
import { getCurrentUser, getGuestId } from "@/lib/auth";
import { getUsage } from "@/lib/billing/usage";
import { getEntitlement } from "@/lib/billing/subscription";
import { isBillingConfigured } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Plan, usage and remaining allowance for the current visitor. */
export async function GET() {
  const user = await getCurrentUser();
  const guestId = user ? null : await getGuestId();
  const usage = getUsage({ userId: user?.id ?? null, guestId });
  const subscription = user ? getEntitlement(user.id).subscription : null;

  return NextResponse.json({
    signedIn: !!user,
    billingConfigured: isBillingConfigured(),
    plan: usage.plan.id,
    planName: usage.plan.name,
    used: usage.used,
    limit: usage.limit,
    remaining: usage.remaining,
    exhausted: usage.exhausted,
    periodStart: usage.period.start,
    periodEnd: usage.periodEnd,
    periodBasis: usage.period.basis,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    renewsAt: subscription?.currentPeriodEnd ?? null,
  });
}
