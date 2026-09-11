import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getCurrentUser } from "@/lib/auth";
import { getStripe } from "@/lib/billing/stripe";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getDeal, updateDeal } from "@/lib/safeswap/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Buyer starts payment on a pending deal. Creates a real Stripe PaymentIntent
 * (not a redirect-based Checkout Session) and returns its client secret for
 * the frontend's Stripe Elements form to confirm.
 *
 * The deal is NOT marked "paid" here - only the payment_intent.succeeded
 * webhook does that (see /api/billing/webhook). A client that lies about
 * success, or never gets a response back at all, can never grant itself a
 * paid deal this way.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to pay." }, { status: 401 });
  }

  const limit = checkRateLimit(`safeswap-pay:${rateLimitKey(request, user.id)}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => null)) as { dealId?: unknown } | null;
  const dealId = typeof body?.dealId === "string" ? body.dealId : "";
  const deal = dealId ? getDeal(dealId) : null;
  if (!deal) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 });
  }
  // Prevent seller from buying own deal.
  if (deal.sellerId === user.id) {
    return NextResponse.json({ error: "You cannot pay for your own deal." }, { status: 403 });
  }
  // Prevent double payment.
  if (deal.status !== "pending") {
    return NextResponse.json({ error: "This deal is not available for payment." }, { status: 409 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Payments are not configured on this server yet." },
      { status: 503 },
    );
  }

  try {
    const intent = await stripe.paymentIntents.create({
      amount: deal.priceCents,
      currency: "usd",
      // Read back by the webhook (and the deal page's own fast-path
      // reconciliation) to know which deal and buyer this belongs to.
      metadata: { system: "safeswap", dealId: deal.id, buyerId: user.id },
    });
    updateDeal(deal.id, { stripePaymentIntentId: intent.id });
    return NextResponse.json({ clientSecret: intent.client_secret });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      console.error(
        `[safeswap] Stripe rejected the PaymentIntent (${err.type}${err.code ? `/${err.code}` : ""}):`,
        err.message,
      );
      return NextResponse.json({ error: `We could not start payment: ${err.message}` }, { status: 502 });
    }
    console.error("[safeswap] could not create a PaymentIntent:", err);
    return NextResponse.json(
      { error: "We could not start payment. Please try again." },
      { status: 502 },
    );
  }
}
