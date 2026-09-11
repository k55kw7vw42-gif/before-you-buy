import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listDealsForUser } from "@/lib/safeswap/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "SafeSwap - Before You Pay" };

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export default async function SafeSwapListPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/safeswap");

  const deals = listDealsForUser(user.id);

  return (
    <div className="stack">
      <div className="btn-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>SafeSwap</h1>
        <Link className="btn btn-primary" href="/safeswap/create">
          New deal
        </Link>
      </div>

      {deals.length === 0 ? (
        <div className="empty">
          <p>You have no SafeSwap deals yet.</p>
          <Link className="btn btn-primary" href="/safeswap/create">
            Create your first deal
          </Link>
        </div>
      ) : (
        <ul className="history-list">
          {deals.map((deal) => (
            <li key={deal.id}>
              <Link className="history-item" href={`/safeswap/${deal.id}`}>
                <span className="history-main">
                  <span className="title">{deal.title}</span>
                  <span className="sub">
                    {formatPrice(deal.priceCents)} ·{" "}
                    {deal.sellerId === user.id ? "You are selling" : "You are buying"}
                  </span>
                </span>
                <span className="badge risk-medium">
                  <span className="dot" aria-hidden="true" />
                  {deal.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
