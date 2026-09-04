import Link from "next/link";
import type { UsageSummary } from "@/lib/billing/usage";
import { formatResetDate } from "@/lib/billing/usage";

/** Compact "scans left" line shown above the scanner. */
export function UsageMeter({ usage, signedIn }: { usage: UsageSummary; signedIn: boolean }) {
  const isPro = usage.plan.id === "pro";
  const pct = Math.min(100, Math.round((usage.used / usage.limit) * 100));
  const low = !isPro && usage.remaining <= 1;

  return (
    <div className={`usage-meter${low ? " usage-low" : ""}`}>
      <div className="usage-line">
        <span>
          <strong>{usage.plan.name} plan</strong> ·{" "}
          {isPro ? (
            <>
              {usage.used} of {usage.limit} analyses used this month
            </>
          ) : (
            <>
              {usage.remaining} of {usage.limit} screenshot {usage.remaining === 1 ? "scan" : "scans"} left
              this month
            </>
          )}
        </span>
        {!isPro && (
          <Link className="usage-cta" href="/pricing">
            Upgrade
          </Link>
        )}
      </div>
      <div className="usage-bar" role="presentation">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="usage-note">
        Resets on {formatResetDate(usage.periodEnd)}. Link checks are unlimited on every plan.
        {!signedIn && " Create an account to keep your allowance across devices."}
      </p>
    </div>
  );
}
