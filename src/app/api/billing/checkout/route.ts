import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getCurrentUser } from "@/lib/auth";
import { baseUrl } from "@/lib/base-url";
import { getBillingConfig, getStripe } from "@/lib/billing/stripe";
import { getSubscription, upsertSubscription } from "@/lib/billing/subscription";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts a hosted Stripe Checkout session and returns its URL. The browser is
 * then redirected to Stripe - no Stripe key or SDK is loaded client-side.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to upgrade." }, { status: 401 });
  }

  const limit = checkRateLimit(`checkout:${rateLimitKey(request, user.id)}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const stripe = getStripe();
  const config = getBillingConfig();
  if (!stripe || !config) {
    return NextResponse.json(
      { error: "Payments are not configured on this server yet." },
      { status: 503 },
    );
  }

  try {
    // Reuse the customer we already created for this user, so a second
    // subscription is never opened against a duplicate customer record.
    let customerId = getSubscription(user.id)?.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      upsertSubscription({ userId: user.id, stripeCustomerId: customerId });
    }

    const base = baseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: config.priceId, quantity: 1 }],
      // Both are echoed back to us, and both are checked before Pro is granted.
      client_reference_id: user.id,
      metadata: { userId: user.id },
      subscription_data: { metadata: { userId: user.id } },
      success_url: `${base}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pricing?checkout=cancelled`,
    });

    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL");
    }
    return NextResponse.json({ url: session.url });
  } catch (err) {
    // A StripeError names the actual problem (bad price id, key/mode
    // mismatch, etc.) - log it in full so it shows up in server logs, and
    // surface the safe, merchant-facing message Stripe generates for it
    // rather than a one-size-fits-all string that hides the real cause.
    if (err instanceof Stripe.errors.StripeError) {
      console.error(
        `[billing] Stripe rejected the Checkout session (${err.type}${err.code ? `/${err.code}` : ""}):`,
        err.message,
      );
      return NextResponse.json(
        { error: `We could not start the checkout: ${err.message}` },
        { status: 502 },
      );
    }
    console.error("[billing] could not create a Checkout session:", err);
    return NextResponse.json(
      { error: "We could not start the checkout. Please try again." },
      { status: 502 },
    );
  }
}
