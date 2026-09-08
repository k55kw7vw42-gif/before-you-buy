"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

/**
 * Fires the GA4 purchase event exactly once for a given Stripe Checkout
 * session, no matter how many times this success page loads for it (a
 * refresh, a bookmark, browser back/forward all land here with the same
 * session_id). The dedup key is the session id itself, remembered in
 * localStorage - the natural identity of "one transaction" for a
 * Checkout-based purchase, and also passed as transaction_id, which is GA4's
 * own recommended field for deduplicating ecommerce events.
 *
 * Only ever rendered by the success page when Stripe has already confirmed
 * the payment server-side (see billing/success/page.tsx) - this component
 * does not itself decide whether a purchase happened, only whether to report
 * one that already did.
 */
export function PurchaseTracker({
  transactionId,
  value,
  currency,
}: {
  transactionId: string;
  value: number;
  currency: string;
}) {
  useEffect(() => {
    const key = `ga_purchase_tracked:${transactionId}`;
    try {
      if (window.localStorage.getItem(key) === "1") return;
    } catch {
      // Storage unavailable (private browsing, etc.) - fall back to sending
      // once per page load rather than not tracking real revenue at all.
    }

    trackEvent("purchase", {
      event_category: "ecommerce",
      transaction_id: transactionId,
      value,
      currency,
    });

    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // Ignore - see above.
    }
  }, [transactionId, value, currency]);

  return null;
}
