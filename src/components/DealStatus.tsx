"use client";

import { useState } from "react";
import type { Deal, DealStatus as DealStatusValue } from "@/lib/deals/types";

const STATUS_LABEL: Record<DealStatusValue, string> = {
  pending_seller: "Waiting for the seller to accept",
  seller_onboarding: "Seller is setting up payouts",
  ready_for_payment: "Ready for the buyer to pay",
  funds_held: "Funds held - waiting for the buyer to release",
  released: "Payment released to the seller",
};

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/** Shows a deal's state and whichever single action is available right now. */
export function DealStatus({
  deal,
  isBuyer,
  shareUrl,
}: {
  deal: Deal;
  isBuyer: boolean;
  shareUrl: string;
}) {
  const [status, setStatus] = useState<DealStatusValue>(deal.status);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const payoutCents = deal.amountCents - deal.feeCents;

  async function callAction(path: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, { method: "POST" });
      const data = (await response.json()) as { url?: string; ok?: boolean; error?: string };
      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      if (data.url) {
        // Onboarding or Checkout: hand off to Stripe's hosted page.
        window.location.assign(data.url);
        return;
      }
      setStatus("released");
      setBusy(false);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <span className="badge risk-medium">
        <span className="dot" aria-hidden="true" />
        {STATUS_LABEL[status]}
      </span>

      <dl className="kv" style={{ marginTop: "1.25rem" }}>
        <div>
          <dt>Deal amount</dt>
          <dd>{formatAmount(deal.amountCents, deal.currency)}</dd>
        </div>
        <div>
          <span className="row-sep" />
          <dt>Platform fee (3%)</dt>
          <dd>{formatAmount(deal.feeCents, deal.currency)}</dd>
        </div>
        <div>
          <span className="row-sep" />
          <dt>Seller receives</dt>
          <dd>{formatAmount(payoutCents, deal.currency)}</dd>
        </div>
        <div>
          <span className="row-sep" />
          <dt>Seller</dt>
          <dd>{deal.sellerEmail}</dd>
        </div>
      </dl>

      {status === "pending_seller" && isBuyer && (
        <p className="small muted" style={{ marginTop: "1rem" }}>
          Share this link with the seller: <code style={{ overflowWrap: "anywhere" }}>{shareUrl}</code>
        </p>
      )}

      {error && (
        <p className="alert" role="alert" style={{ marginTop: "1rem" }}>
          {error}
        </p>
      )}

      <div style={{ marginTop: "1.5rem" }}>
        {!isBuyer && status === "pending_seller" && (
          <button
            className="btn btn-primary btn-block"
            type="button"
            disabled={busy}
            onClick={() => callAction(`/api/deal/${deal.id}/accept`)}
          >
            {busy ? "Starting..." : "Accept Deal"}
          </button>
        )}

        {!isBuyer && status === "seller_onboarding" && (
          <button
            className="btn btn-secondary btn-block"
            type="button"
            disabled={busy}
            onClick={() => callAction(`/api/deal/${deal.id}/accept`)}
          >
            {busy ? "Starting..." : "Continue payout setup"}
          </button>
        )}

        {isBuyer && status === "ready_for_payment" && (
          <button
            className="btn btn-primary btn-block"
            type="button"
            disabled={busy}
            onClick={() => callAction(`/api/deal/${deal.id}/pay`)}
          >
            {busy ? "Starting checkout..." : `Pay ${formatAmount(deal.amountCents, deal.currency)}`}
          </button>
        )}

        {isBuyer && status === "funds_held" && (
          <button
            className="btn btn-primary btn-block"
            type="button"
            disabled={busy}
            onClick={() => callAction(`/api/deal/${deal.id}/release`)}
          >
            {busy ? "Releasing..." : "Release Payment to Seller"}
          </button>
        )}

        {status === "released" && (
          <p className="muted" style={{ margin: 0 }}>
            This deal is complete.
          </p>
        )}
      </div>
    </div>
  );
}
