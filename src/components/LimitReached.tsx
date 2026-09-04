import Link from "next/link";
import { PLANS } from "@/lib/billing/plans";
import type { UsageSummary } from "@/lib/billing/usage";
import { formatResetDate } from "@/lib/billing/usage";
import { UpgradeButton } from "./UpgradeButton";

/** Shown in place of the uploader once the monthly allowance is spent. */
export function LimitReached({
  usage,
  signedIn,
  billingConfigured,
}: {
  usage: UsageSummary;
  signedIn: boolean;
  billingConfigured: boolean;
}) {
  const isPro = usage.plan.id === "pro";

  return (
    <section className="card">
      <span className="badge risk-medium">
        <span className="dot" aria-hidden="true" />
        Limit reached
      </span>
      <h2 style={{ marginTop: "0.75rem" }}>
        {isPro
          ? `You've used all ${usage.limit} analyses this month`
          : `You've used your ${usage.limit} free analyses this month`}
      </h2>

      {isPro ? (
        <p className="muted">
          Your allowance resets on {formatResetDate(usage.periodEnd)}. Link checks still work in
          the meantime.
        </p>
      ) : (
        <>
          <p className="muted">
            Upgrade to Pro for {PLANS.pro.monthlyScans} screenshot analyses a month at{" "}
            {PLANS.pro.priceLabel}, or wait until your free allowance resets on{" "}
            {formatResetDate(usage.periodEnd)}.
          </p>
          <div style={{ marginTop: "1.25rem" }}>
            <UpgradeButton signedIn={signedIn} billingConfigured={billingConfigured} />
          </div>
          <p className="small muted" style={{ marginTop: "1rem", marginBottom: 0 }}>
            <Link href="/pricing">Compare plans</Link> · Link checks are free and unlimited on
            every plan, so you can still <Link href="/link">check a link</Link>.
          </p>
        </>
      )}
    </section>
  );
}
