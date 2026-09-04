import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PLANS } from "@/lib/billing/plans";
import { isBillingConfigured } from "@/lib/billing/stripe";
import { getEntitlement } from "@/lib/billing/subscription";
import { formatResetDate, getUsage } from "@/lib/billing/usage";
import { UpgradeButton } from "@/components/UpgradeButton";
import { ManageBillingButton } from "@/components/ManageBillingButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your plan - Before You Pay" };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");

  const { plan, subscription } = getEntitlement(user.id);
  const usage = getUsage({ userId: user.id, guestId: null });
  const isPro = plan.id === "pro";
  const pct = Math.min(100, Math.round((usage.used / usage.limit) * 100));

  return (
    <div className="stack-lg">
      <div>
        <h1>Your plan</h1>
        <p className="muted">{user.email}</p>
      </div>

      <section className="card">
        <div className="plan-header">
          <div>
            <span className={`badge ${isPro ? "risk-low" : "risk-medium"}`}>
              <span className="dot" aria-hidden="true" />
              {plan.name} plan
            </span>
            <h2 style={{ marginTop: "0.75rem", marginBottom: "0.25rem" }}>
              {isPro ? `${plan.priceLabel} / month` : "No subscription"}
            </h2>
            <p className="muted small" style={{ marginBottom: 0 }}>
              {plan.monthlyScans} screenshot analyses a month
            </p>
          </div>
          <div className="plan-header-action">
            {isPro ? (
              <ManageBillingButton />
            ) : (
              <UpgradeButton signedIn billingConfigured={isBillingConfigured()} />
            )}
          </div>
        </div>

        {isPro && subscription && (
          <p className="small muted" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
            {subscription.cancelAtPeriodEnd
              ? `Your subscription is set to cancel${subscription.currentPeriodEnd ? ` on ${formatDate(subscription.currentPeriodEnd)}` : ""}. You keep Pro until then.`
              : subscription.currentPeriodEnd
                ? `Renews on ${formatDate(subscription.currentPeriodEnd)}.`
                : null}
          </p>
        )}
      </section>

      <section className="card">
        <h2>This month&apos;s usage</h2>
        <p className="usage-headline">
          <strong>{usage.used}</strong> of {usage.limit} screenshot analyses used
        </p>
        <div className="usage-bar usage-bar-lg" role="presentation">
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="small muted" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
          {usage.remaining > 0
            ? `${usage.remaining} remaining. Resets on ${formatResetDate(usage.periodEnd)}.`
            : `You have used your whole allowance. It resets on ${formatResetDate(usage.periodEnd)}.`}{" "}
          Link checks are unlimited and do not count.
        </p>
        {!isPro && usage.remaining === 0 && (
          <p className="notice-strip" style={{ marginTop: "1rem" }}>
            Need more? Pro includes {PLANS.pro.monthlyScans} analyses a month.{" "}
            <Link href="/pricing">See pricing</Link>.
          </p>
        )}
      </section>

      <div className="btn-row">
        <Link className="btn btn-primary" href="/scan">
          Scan a screenshot
        </Link>
        <Link className="btn btn-secondary" href="/history">
          Scan history
        </Link>
      </div>
    </div>
  );
}
