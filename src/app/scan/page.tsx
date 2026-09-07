import Link from "next/link";
import { ScanUploader } from "@/components/ScanUploader";
import { LimitReached } from "@/components/LimitReached";
import { SignInToScan } from "@/components/SignInToScan";
import { UsageMeter } from "@/components/UsageMeter";
import { isDemoMode } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";
import { isBillingConfigured } from "@/lib/billing/stripe";
import { getUsage } from "@/lib/billing/usage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scan a screenshot - Before You Pay" };

export default async function ScanPage() {
  const user = await getCurrentUser();
  const usage = getUsage({ userId: user?.id ?? null, guestId: null });

  return (
    <div className="stack">
      <div>
        <h1>Scan a screenshot</h1>
        <p className="muted">
          Upload a screenshot of the offer, message, invoice, listing or payment request. We look
          for common scam warning signs and tell you what to check before you pay.
        </p>
      </div>

      {/* Usage meter */}
      {user && <UsageMeter usage={usage} signedIn />}

      {/* Upgrade hint before the allowance runs out */}
      {user && !usage.exhausted && usage.plan.id !== "pro" && (
        <div
          className="small"
          style={{
            marginTop: "0.75rem",
            padding: "0.75rem 0.9rem",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--medium-border)",
            background: "var(--medium-bg)",
            color: "var(--medium)",
            textAlign: "center",
          }}
        >
          <p style={{ fontWeight: 600, margin: 0 }}>
            ⚠️ {usage.remaining} scans left this month
          </p>
          <Link href="/pricing" style={{ fontWeight: 700, textDecoration: "underline", color: "inherit" }}>
            Upgrade to Pro
          </Link>
        </div>
      )}

      {/* Demo mode */}
      {isDemoMode() && (
        <p className="notice-strip">
          Demo mode: no AI provider is configured, so the screenshot itself is not read. Anything
          you type in the notes box below is still analysed.
        </p>
      )}

      {/* الحالات */}
      {!user ? (
        <SignInToScan />
      ) : usage.exhausted ? (
        <LimitReached usage={usage} signedIn billingConfigured={isBillingConfigured()} />
      ) : (
        <ScanUploader />
      )}
    </div>
  );
}
