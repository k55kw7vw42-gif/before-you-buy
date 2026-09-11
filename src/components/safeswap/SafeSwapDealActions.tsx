"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SafeSwapDeal } from "@/lib/safeswap/types";
import { SafeSwapPayForm } from "./SafeSwapPayForm";

/** Whichever single action (Pay / Confirm Delivery / Dispute) fits the current status and viewer. */
export function SafeSwapDealActions({
  deal,
  isBuyer,
  isSeller,
}: {
  deal: SafeSwapDeal;
  isBuyer: boolean;
  isSeller: boolean;
}) {
  const router = useRouter();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startPayment() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/safeswap/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: deal.id }),
      });
      const data = (await response.json()) as { clientSecret?: string; error?: string };
      if (!response.ok || !data.clientSecret) {
        setError(data.error ?? "Could not start payment.");
        setBusy(false);
        return;
      }
      setClientSecret(data.clientSecret);
      setBusy(false);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  async function callAction(path: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: deal.id }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div>
      {error && (
        <p className="alert" role="alert" style={{ marginBottom: "1rem" }}>
          {error}
        </p>
      )}

      {deal.status === "pending" && !isSeller && !clientSecret && (
        <button className="btn btn-primary btn-block" type="button" disabled={busy} onClick={startPayment}>
          {busy ? "Starting..." : "Pay"}
        </button>
      )}

      {clientSecret && <SafeSwapPayForm dealId={deal.id} clientSecret={clientSecret} />}

      {deal.status === "paid" && isBuyer && (
        <div className="btn-row">
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={() => callAction("/api/safeswap/release")}
          >
            {busy ? "Releasing..." : "Confirm Delivery"}
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={busy}
            onClick={() => callAction("/api/safeswap/dispute")}
          >
            Dispute
          </button>
        </div>
      )}

      {deal.status === "released" && (
        <p className="muted" style={{ margin: 0 }}>
          This deal is complete.
        </p>
      )}

      {deal.status === "disputed" && (
        <p className="alert" role="alert" style={{ margin: 0 }}>
          This deal is under dispute.
        </p>
      )}
    </div>
  );
}
