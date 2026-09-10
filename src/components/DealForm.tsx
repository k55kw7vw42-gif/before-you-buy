"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Buyer-facing form that starts a new protected deal. */
export function DealForm() {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [sellerEmail, setSellerEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/deal/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), sellerEmail }),
      });
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !data.id) {
        setError(data.error ?? "We could not create this deal. Please try again.");
        setBusy(false);
        return;
      }
      router.push(`/deal/${data.id}`);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      {error && (
        <p className="alert" role="alert" style={{ marginBottom: "1rem" }}>
          {error}
        </p>
      )}

      <div className="field">
        <label htmlFor="amount">Deal amount (USD)</label>
        <input
          id="amount"
          type="number"
          inputMode="decimal"
          min="1"
          step="0.01"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="500"
        />
      </div>

      <div className="field">
        <label htmlFor="sellerEmail">Seller&apos;s email</label>
        <input
          id="sellerEmail"
          type="email"
          required
          value={sellerEmail}
          onChange={(e) => setSellerEmail(e.target.value)}
          placeholder="seller@example.com"
        />
        <p className="hint" style={{ marginTop: "0.4rem" }}>
          You&apos;ll get a link on the next page to send them.
        </p>
      </div>

      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        {busy ? (
          <>
            <span className="spinner" aria-hidden="true" /> Creating deal...
          </>
        ) : (
          "Create Protected Deal"
        )}
      </button>
    </form>
  );
}
