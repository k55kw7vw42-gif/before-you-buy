"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Starts Checkout. The session is created on the server; the browser only ever
 * receives a URL to follow, so no Stripe key is present client-side.
 */
export function UpgradeButton({
  signedIn,
  billingConfigured,
  className = "btn btn-primary",
  label = "Upgrade to Pro",
}: {
  signedIn: boolean;
  billingConfigured: boolean;
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <a className={className} href="/signup?next=/pricing">
        {label}
      </a>
    );
  }

  if (!billingConfigured) {
    return (
      <div>
        <button className={className} type="button" disabled>
          {label}
        </button>
        <p className="small muted" style={{ margin: "0.5rem 0 0" }}>
          Payments are not configured on this server yet.
        </p>
      </div>
    );
  }

  async function upgrade() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", { method: "POST" });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        setError(data.error ?? "We could not start the checkout. Please try again.");
        setBusy(false);
        return;
      }
      if (response.status === 401) {
        router.push("/login?next=/pricing");
        return;
      }
      // Hand off to Stripe's hosted Checkout page.
      window.location.assign(data.url);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button className={className} type="button" onClick={upgrade} disabled={busy}>
        {busy ? (
          <>
            <span className="spinner" aria-hidden="true" /> Starting checkout...
          </>
        ) : (
          label
        )}
      </button>
      {error && (
        <p className="alert" role="alert" style={{ marginTop: "0.75rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}
