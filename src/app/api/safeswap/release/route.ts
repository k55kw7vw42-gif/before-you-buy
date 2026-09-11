import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getCurrentUser } from "@/lib/auth";
import { getStripe } from "@/lib/billing/stripe";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getSellerStripeAccountId } from "@/lib/safeswap/connect";
import { splitAmount } from "@/lib/safeswap/fees";
import { getDeal, recordTransaction, updateDeal } from "@/lib/safeswap/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Buyer confirms delivery and releases the held payment: 97% to the seller,
 * 3% kept as the platform fee. Only the assigned buyer can do this.
 *
 * getSellerStripeAccountId is a placeholder (see lib/safeswap/connect.ts) and
 * always returns null until real Connect onboarding exists, so this route
 * will correctly refuse to release with a clear error until that is wired
 * up - it does not fake a payout or crash.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to release this payment." }, { status: 401 });
  }

  const limit = checkRateLimit(`safeswap-release:${rateLimitKey(request, user.id)}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => null)) as { dealId?: unknown } | null;
  const dealId = typeof body?.dealId === "string" ? body.dealId : "";
  const deal = dealId ? getDeal(dealId) : null;
  if (!deal || deal.buyerId !== user.id) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 });
  }
  // Prevent release if not paid; prevent release if already released.
  if (deal.status !== "paid") {
    const message =
      deal.status === "released"
        ? "This deal has already been released."
        : deal.status === "disputed"
          ? "This deal is under dispute and cannot be released."
          : "This deal has not been paid yet.";
    return NextResponse.json({ error: message }, { status: 409 });
  }

  const sellerAccountId = getSellerStripeAccountId(deal.sellerId);
  if (!sellerAccountId) {
    return NextResponse.json(
      { error: "The seller has not connected a payout account yet, so this cannot be released yet." },
      { status: 409 },
    );
  }

  const stripe = getStripe();
  if (!stripe || !deal.stripePaymentIntentId) {
    return NextResponse.json(
      { error: "Payments are not configured on this server yet." },
      { status: 503 },
    );
  }

  try {
    const { platformFeeCents, sellerAmountCents } = splitAmount(deal.priceCents);

    // Transfer from the original Charge behind this deal's PaymentIntent, so
    // the payout is traceable back to exactly which payment funded it.
    const paymentIntent = await stripe.paymentIntents.retrieve(deal.stripePaymentIntentId);
    const chargeId =
      typeof paymentIntent.latest_charge === "string"
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id;

    await stripe.transfers.create({
      amount: sellerAmountCents,
      currency: "usd",
      destination: sellerAccountId,
      ...(chargeId ? { source_transaction: chargeId } : {}),
      metadata: { system: "safeswap", dealId: deal.id },
    });

    recordTransaction({
      dealId: deal.id,
      amountCents: deal.priceCents,
      platformFeeCents,
      sellerAmountCents,
      status: "succeeded",
    });
    updateDeal(deal.id, { status: "released" });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      console.error(
        `[safeswap] Stripe rejected the release transfer (${err.type}${err.code ? `/${err.code}` : ""}):`,
        err.message,
      );
      return NextResponse.json(
        { error: `We could not release the payment: ${err.message}` },
        { status: 502 },
      );
    }
    console.error("[safeswap] could not release payment:", err);
    return NextResponse.json(
      { error: "We could not release the payment. Please try again." },
      { status: 502 },
    );
  }
}
