import Link from "next/link";
import { getCurrentUser, getGuestId } from "@/lib/auth";
import { PLANS } from "@/lib/billing/plans";
import { isBillingConfigured } from "@/lib/billing/stripe";
import { getUsage } from "@/lib/billing/usage";
import { UpgradeButton } from "@/components/UpgradeButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pricing - Before You Pay" };

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="m3.5 8.5 3 3 6-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { checkout } = await searchParams;
  const user = await getCurrentUser();
  const guestId = user ? null : await getGuestId();
  const usage = getUsage({ userId: user?.id ?? null, guestId });
  const billingConfigured = isBillingConfigured();
  const currentPlan = usage.plan.id;

  return (
    <div className="stack-lg">
      <div>
        <h1>Pricing</h1>
        <p className="muted" style={{ maxWidth: "34rem" }}>
          Every plan gives you the full analysis - the same risk score, warning signs and
          recommended next steps. The plans differ only in how many screenshots you can check
          each month.
        </p>
      </div>

      {checkout === "cancelled" && (
        <p className="notice-strip">
          Checkout cancelled - you have not been charged. You are still on the{" "}
          {usage.plan.name} plan.
        </p>
      )}

      <div className="plan-grid">
        {(["free", "pro"] as const).map((id) => {
          const plan = PLANS[id];
          const isCurrent = currentPlan === id;
          return (
            <section key={id} className={`card plan-card${id === "pro" ? " plan-featured" : ""}`}>
              {id === "pro" && <span className="plan-tag">Most popular</span>}
              <h2>{plan.name}</h2>
              <p className="plan-price">
                {plan.priceLabel}
                <span className="plan-period">{id === "pro" ? "/month" : ""}</span>
              </p>
              <p className="muted small">{plan.blurb}</p>
              <ul className="plan-features">
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <Check />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="plan-action">
                {isCurrent ? (
                  <span className="badge risk-low">
                    <span className="dot" aria-hidden="true" />
                    Your current plan
                  </span>
                ) : id === "pro" ? (
                  <UpgradeButton
                    signedIn={!!user}
                    billingConfigured={billingConfigured}
                    className="btn btn-primary btn-block"
                  />
                ) : (
                  <Link className="btn btn-secondary btn-block" href="/scan">
                    Start scanning
                  </Link>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <section className="card card-flat">
        <h2>Questions</h2>
        <dl className="faq">
          <dt>What counts towards my monthly limit?</dt>
          <dd>
            Only screenshot analyses, because those are what call the AI vision model. Link
            checks are free and unlimited on every plan.
          </dd>
          <dt>When does my allowance reset?</dt>
          <dd>On the first day of each calendar month.</dd>
          <dt>Can I cancel?</dt>
          <dd>
            Yes, any time, from{" "}
            {user ? <Link href="/account">your account page</Link> : "your account page"}. You
            keep Pro until the end of the period you have already paid for.
          </dd>
          <dt>Is a failed or rejected scan charged to my allowance?</dt>
          <dd>No. Only a completed analysis counts.</dd>
        </dl>
      </section>
    </div>
  );
}
