import Link from "next/link";
import { PLANS } from "@/lib/billing/plans";
import type { UsageSummary } from "@/lib/billing/usage";
import { formatResetDate, periodLabel } from "@/lib/billing/usage";
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
      {/* 🔴 Header */}
      <span className="badge risk-medium">
        <span className="dot" aria-hidden="true" />
        🚨 Protection paused
      </span>

      {/* 🧠 Title */}
      <h2 style={{ marginTop: "0.75rem" }}>
        {isPro
          ? `You've used all ${usage.limit} analyses ${periodLabel(usage.period)}`
          : `You're out of free protection this month`}
      </h2>

      {isPro ? (
        <p className="muted">
          Your allowance resets on {formatResetDate(usage.periodEnd)}.
        </p>
      ) : (
        <>
          {/* 💣 Message */}
          <p className="muted">
            You've used all your free scans. Don't risk sending money without checking.
          </p>

          {/* ✅ Benefits */}
          <div style={{ marginTop: "1rem" }}>
            <ul
              className="small"
              style={{
                textAlign: "left",
                margin: "0 auto",
                maxWidth: 300,
              }}
            >
              <li>✔ Continue scanning before you pay</li>
              <li>✔ Stay protected from scams</li>
              <li>✔ Ad-free experience</li>
            </ul>
          </div>

          {/* 🔓 Upgrade Button */}
          <div style={{ marginTop: "1.5rem" }}>
            <UpgradeButton
              signedIn={signedIn}
              billingConfigured={billingConfigured}
            />
          </div>

          {/* ⚠️ Reset notice */}
          <p className="small muted" style={{ marginTop: "1rem" }}>
            ⚠️ Your protection resets on {formatResetDate(usage.periodEnd)}
          </p>

          {/* 🔗 Pricing link */}
          <p
            className="small muted"
            style={{ marginTop: "0.5rem", marginBottom: 0 }}
          >
            <Link href="/pricing">Compare plans</Link>
          </p>
        </>
      )}
    </section>
  );
}
