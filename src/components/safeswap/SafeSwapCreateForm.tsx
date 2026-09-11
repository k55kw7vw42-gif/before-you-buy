"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

/** Seller-facing form that starts a new SafeSwap deal. */
export function SafeSwapCreateForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/safeswap/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, price: Number(price) }),
      });
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !data.id) {
        setError(data.error ?? "We could not create this deal. Please try again.");
        setBusy(false);
        return;
      }
      router.push(`/safeswap/${data.id}`);
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
        <label htmlFor="title">Title</label>
        <input
          id="title"
          type="text"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Vintage camera"
        />
      </div>

      <div className="field">
        <label htmlFor="price">Price (USD)</label>
        <input
          id="price"
          type="number"
          inputMode="decimal"
          min="1"
          step="0.01"
          required
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="150"
        />
      </div>

      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        {busy ? "Creating..." : "Create Deal"}
      </button>
    </form>
  );
}
