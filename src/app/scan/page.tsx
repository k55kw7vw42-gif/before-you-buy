import { ScanUploader } from "@/components/ScanUploader";
import { LimitReached } from "@/components/LimitReached";
import { UsageMeter } from "@/components/UsageMeter";
import { isDemoMode } from "@/lib/ai";
import { getCurrentUser, getGuestId } from "@/lib/auth";
import { isBillingConfigured } from "@/lib/billing/stripe";
import { getUsage } from "@/lib/billing/usage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scan a screenshot - Before You Pay" };

export default async function ScanPage() {
  const user = await getCurrentUser();
  const guestId = user ? null : await getGuestId();
  const usage = getUsage({ userId: user?.id ?? null, guestId });

  return (
    <div className="stack">
      <div>
        <h1>Scan a screenshot</h1>
        <p className="muted">
          Upload a screenshot of the offer, message, invoice, listing or payment request. We look
          for common scam warning signs and tell you what to check before you pay.
        </p>
      </div>

      <UsageMeter usage={usage} signedIn={!!user} />

      {isDemoMode() && (
        <p className="notice-strip">
          Demo mode: no AI provider is configured, so the screenshot itself is not read. Anything
          you type in the notes box below is still analysed.
        </p>
      )}

      {usage.exhausted ? (
        <LimitReached
          usage={usage}
          signedIn={!!user}
          billingConfigured={isBillingConfigured()}
        />
      ) : (
        <ScanUploader />
      )}
    </div>
  );
}
