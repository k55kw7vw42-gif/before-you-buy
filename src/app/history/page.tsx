import Link from "next/link";
import { redirect } from "next/navigation";
import { RiskBadge } from "@/components/RiskBadge";
import { getCurrentUser } from "@/lib/auth";
import { PLANS } from "@/lib/billing/plans";
import { getUsage } from "@/lib/billing/usage";
import { listScansForUser } from "@/lib/scans";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your scan history - Before You Pay" };

function formatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000 / 60);

  if (diff < 60) return `${diff} min ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)} hours ago`;

  return date.toLocaleDateString();
}

export default async function HistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/history");

  const scans = listScansForUser(user.id);
  const usage = getUsage({ userId: user.id, guestId: null });

  return (
    <div className="stack">
      {/* 🧠 Header */}
      <div>
        <h1>Your scan history</h1>
        <p className="muted">Only you can see these scans.</p>
      </div>

      <div className="card" style={{ textAlign: "center" }}>
        <p style={{ fontWeight: 700, margin: 0 }}>🔍 Keep checking links</p>
        <p className="small muted" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
          Link checks are free and unlimited on every plan.
        </p>
        <Link href="/link" className="btn btn-primary" style={{ marginTop: "0.85rem" }}>
          Check another link
        </Link>
      </div>

      {usage.plan.id !== "pro" && (
        <div className="card" style={{ textAlign: "center" }}>
          <p style={{ fontWeight: 700, margin: 0 }}>😤 Avoid scams like these - upgrade to Pro</p>
          <p className="small muted" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
            Upgrade to Pro for {PLANS.pro.monthlyScans} screenshot analyses a month at{" "}
            {PLANS.pro.priceLabel}.
          </p>
          <Link href="/pricing" className="btn btn-primary" style={{ marginTop: "0.85rem" }}>
            Upgrade
          </Link>
        </div>
      )}

      {/* 🧾 Content */}
      {scans.length === 0 ? (
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M3 12a9 9 0 1 0 3-6.7"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
              <path
                d="M3 4v4h4M12 8v4.5l3 2"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <p>🔍 Start by checking your first link or screenshot</p>

          <Link className="btn btn-primary" href="/scan">
            Scan a screenshot
          </Link>
        </div>
      ) : (
        <ul className="history-list">
          {scans.map((scan) => (
            <li key={scan.id}>
              <Link className="history-item" href={`/results/${scan.id}`}>
                <span className={`history-score risk-${scan.level}`}>{scan.score}</span>
                <span className="history-main">
                  <span className="title">{scan.sourceLabel}</span>
                  <span className="sub">{scan.summary}</span>
                  <span className="hint">Tap to view details →</span>
                </span>
                <RiskBadge level={scan.level} />
                <span className="history-date">{formatDate(scan.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
