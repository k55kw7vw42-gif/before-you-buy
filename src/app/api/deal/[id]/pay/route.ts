import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getCurrentUser } from "@/lib/auth";
import { baseUrl } from "@/lib/base-url";
import { getStripe } from "@/lib/billing/stripe";
import { getDeal, updateDeal } from "@/lib/deals/store";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The buyer paying the full deal amount. This is a plain one-time Checkout
 * Session with no destination/transfer_data - the money lands entirely in
 * the platform's own Stripe balance, held there until the buyer releases it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to pay for this deal." }, { status: 401 });
  }

  const limit = checkRateLimit(`deal-pay:${rateLimitKey(request, user.id)}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const deal = getDeal(id);
  if (!deal || deal.buyerId !== user.id) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 });
  }
  if (deal.status !== "ready_for_payment") {
    return NextResponse.json({ error: "This deal is not ready for payment yet." }, { status: 409 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Payments are not configured on this server yet." },
      { status: 503 },
    );
  }

  try {
    const base = baseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      line_items: [
        {
          price_data: {
            currency: deal.currency,
            unit_amount: deal.amountCents,
            product_data: {
              name: "Protected deal payment",
              description: `Held until you release it to ${deal.sellerEmail}`,
            },
          },
          quantity: 1,
        },
      ],
      // Read back by both the webhook and this deal's own page-load
      // reconciliation - see applyDealPayment.
      metadata: { kind: "deal", dealId: deal.id },
      success_url: `${base}/deal/${deal.id}?paid=1`,
      cancel_url: `${base}/deal/${deal.id}?paid=0`,
    });

    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL");
    }
    updateDeal(deal.id, { stripeCheckoutSessionId: session.id });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      console.error(
        `[deals] Stripe rejected the deal Checkout session (${err.type}${err.code ? `/${err.code}` : ""}):`,
        err.message,
      );
      return NextResponse.json(
        { error: `We could not start the checkout: ${err.message}` },
        { status: 502 },
      );
    }
    console.error("[deals] could not create a deal Checkout session:", err);
    return NextResponse.json(
      { error: "We could not start the checkout. Please try again." },
      { status: 502 },
    );
  }
}
