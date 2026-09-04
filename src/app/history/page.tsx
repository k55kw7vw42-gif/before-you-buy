import Link from "next/link";
import { redirect } from "next/navigation";
import { RiskBadge } from "@/components/RiskBadge";
import { getCurrentUser } from "@/lib/auth";
import { listScansForUser } from "@/lib/scans";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your scan history - Before You Pay" };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function HistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/history");

  const scans = listScansForUser(user.id);

  return (
    <div className="stack">
      <div>
        <h1>Your scan history</h1>
        <p className="muted">Only you can see these scans.</p>
      </div>

      {scans.length === 0 ? (
        <div className="empty">
          <p>You have not run any scans yet.</p>
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
