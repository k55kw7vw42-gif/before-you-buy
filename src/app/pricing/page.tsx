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
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
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
  searchParams: Promise<{ checkout?: string }>; // ✅ مهم
}) {
  const { checkout } = await searchParams; // ✅ مهم

  const user = await getCurrentUser();
  const guestId = user ? null : await getGuestId();
  const usage = getUsage({ userId: user?.id ?? null, guestId });
  const billingConfigured = isBillingConfigured();
  const currentPlan = usage.plan.id;

  return (
    <div className="stack-lg">
      <div>
        <h1>Pricing</h1>
        <p className="muted">
          Every plan gives you the full analysis.
        </p>
      </div>

      {checkout === "cancelled" && (
        <p className="notice-strip">
          Checkout cancelled - you are still on {usage.plan.name}.
        </p>
      )}

      <div className="plan-grid">
        {(["free", "pro"] as const).map((id) => {
          const plan = PLANS[id];
          const isCurrent = currentPlan === id;

          return (
            <section key={id} className="card">
              <h2>{plan.name}</h2>
              <p>{plan.priceLabel}</p>

              <ul>
                {plan.features.map((f) => (
                  <li key={f}>
                    <Check /> {f}
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <span>Your current plan</span>
              ) : id === "pro" ? (
                <UpgradeButton
                  signedIn={!!user}
                  billingConfigured={billingConfigured}
                />
              ) : (
                <Link href="/scan">Start</Link>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
