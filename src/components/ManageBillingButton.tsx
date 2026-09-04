"use client";

import { useState } from "react";

/** Opens Stripe's billing portal, where the subscription can be changed or cancelled. */
export function ManageBillingButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        setError(data.error ?? "We could not open the billing portal.");
        setBusy(false);
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError("We could not reach the server. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn btn-secondary" type="button" onClick={open} disabled={busy}>
        {busy ? "Opening..." : "Manage subscription"}
      </button>
      {error && (
        <p className="alert" role="alert" style={{ marginTop: "0.75rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}
