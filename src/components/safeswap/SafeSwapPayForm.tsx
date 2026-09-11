"use client";

import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useState } from "react";
import type { FormEvent } from "react";

// Loaded once, module-level - this is a publishable key, safe to expose to
// the browser (unlike the app's other Stripe usage, which never loads
// Stripe.js at all because it only ever uses hosted Checkout). A raw
// PaymentIntent flow, as SafeSwap explicitly requires, has no way around
// collecting card details client-side.
const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

function PayFormInner({ dealId }: { dealId: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/safeswap/${dealId}?paid=1` },
    });
    // Stripe redirects to return_url itself on success. Only a synchronous
    // failure (e.g. a declined card) comes back here directly.
    if (confirmError) {
      setError(confirmError.message ?? "Payment failed. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginTop: "1rem" }}>
      <PaymentElement />
      {error && (
        <p className="alert" role="alert" style={{ marginTop: "1rem" }}>
          {error}
        </p>
      )}
      <button
        className="btn btn-primary btn-block"
        type="submit"
        disabled={!stripe || busy}
        style={{ marginTop: "1rem" }}
      >
        {busy ? "Processing..." : "Pay"}
      </button>
    </form>
  );
}

/** Embeds a Stripe Elements card form for one PaymentIntent's client secret. */
export function SafeSwapPayForm({ dealId, clientSecret }: { dealId: string; clientSecret: string }) {
  if (!stripePromise) {
    return (
      <p className="alert" role="alert" style={{ marginTop: "1rem" }}>
        Payments are not configured on this server yet.
      </p>
    );
  }
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <PayFormInner dealId={dealId} />
    </Elements>
  );
}
