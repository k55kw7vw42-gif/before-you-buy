import { ScanUploader } from "@/components/ScanUploader";
import { isDemoMode } from "@/lib/ai";

export const metadata = { title: "Scan a screenshot - Before You Pay" };

export default function ScanPage() {
  return (
    <div className="stack">
      <div>
        <h1>Scan a screenshot</h1>
        <p className="muted">
          Upload a screenshot of the offer, message, invoice, listing or payment request. We look
          for common scam warning signs and tell you what to check before you pay.
        </p>
      </div>
      {isDemoMode() && (
        <p className="notice-strip">
          Demo mode: no AI provider is configured, so the screenshot itself is not read. Anything
          you type in the notes box below is still analysed.
        </p>
      )}
      <ScanUploader />
    </div>
  );
}
