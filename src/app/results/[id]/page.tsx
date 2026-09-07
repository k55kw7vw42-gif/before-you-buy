import Link from "next/link";
import { notFound } from "next/navigation";
import { AdBanner } from "@/components/AdBanner";
import { ScanResult } from "@/components/ScanResult";
import { areAdsEnabled } from "@/lib/ads";
import { getCurrentUser, getGuestId } from "@/lib/auth";
import { getEntitlement } from "@/lib/billing/subscription";
import { getScanForOwner } from "@/lib/scans";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scan result - Before You Pay" };

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const guestId = user ? null : await getGuestId();

  const scan = getScanForOwner(id, { userId: user?.id ?? null, guestId });
  // Someone else's scan is indistinguishable from one that does not exist.
  if (!scan) notFound();

  // A signed-out visitor is never Pro; only a signed-in user can be.
  const isPro = user ? getEntitlement(user.id).plan.id === "pro" : false;
  const showAd = areAdsEnabled() && !isPro;

  // This page is shared by link and screenshot scans, and by every risk
  // level - the scam-style warning only makes sense for a link that our own
  // scoring actually flagged, otherwise it would contradict the verdict
  // shown above it.
  const isRiskyLink = scan.scanType === "link" && scan.level !== "low";

  return (
    <div className="stack-lg">
      <ScanResult scan={scan} />

      {isRiskyLink && (
        <>
          <p
            className="small"
            style={{ marginTop: "0.5rem", marginBottom: 0, fontWeight: 700, color: "var(--high)" }}
          >
            ⚠️ This link shows suspicious patterns
          </p>

          <div className="alert" role="alert" style={{ marginTop: "0.75rem" }}>
            🚨 Recommendation: Do NOT enter passwords or payment details on this site.
          </div>
        </>
      )}

      {scan.scanType === "link" && (
        <div className="small muted" style={{ marginTop: "1rem" }}>
          <p style={{ fontWeight: 600, marginBottom: "0.35rem" }}>🔎 We checked:</p>
          <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
            <li>Domain patterns</li>
            <li>Redirect behavior</li>
            <li>Known scam signals</li>
          </ul>
        </div>
      )}

      {/* Mid-content placement: after the scan-specific findings the visitor
          came here for, before the closing upgrade pitch. Deliberately not
          placed above ScanResult - this page's job is to deliver a risk
          verdict as fast as possible, and an ad ahead of that would work
          against the one thing the app exists to do. */}
      {showAd && <AdBanner slot="1234567890" />}

      <div
        className="card"
        style={{ marginTop: "1.5rem", textAlign: "center", background: "var(--brand-gradient)", color: "#fff" }}
      >
        <p style={{ fontWeight: 800, margin: 0 }}>😤 Want unlimited protection?</p>
        <p className="small" style={{ marginTop: "0.35rem", marginBottom: 0, opacity: 0.9 }}>
          Upgrade to Pro for more scans and no ads.
        </p>
        <Link
          href="/pricing"
          className="btn btn-block"
          style={{ marginTop: "0.85rem", background: "var(--bg-elevated)", color: "#fff" }}
        >
          🔓 Upgrade to Pro
        </Link>
      </div>

      {!user && (
        <p className="notice-strip">
          <Link href="/signup">Create an account</Link> to keep this result in your scan history.
        </p>
      )}
    </div>
  );
}
