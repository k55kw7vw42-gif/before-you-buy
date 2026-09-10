import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getCurrentUser } from "@/lib/auth";
import { getStripe } from "@/lib/billing/stripe";
import { splitAmount } from "@/lib/deals/fees";
import { getDeal, updateDeal } from "@/lib/deals/store";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The buyer releasing held funds. Only the buyer can do this - it is their
 * confirmation that the deal completed. Transfers 97% of the amount to the
 * seller's Connect account from the original Charge; the 3% fee is never
 * transferred out, so it simply stays in the platform's balance.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to release this payment." }, { status: 401 });
  }

  const limit = checkRateLimit(`deal-release:${rateLimitKey(request, user.id)}`, 10, 60_000);
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
  if (deal.status !== "funds_held") {
    return NextResponse.json({ error: "This deal has no held funds to release." }, { status: 409 });
  }
  if (!deal.stripeConnectAccountId || !deal.stripeChargeId) {
    return NextResponse.json({ error: "This deal is missing payment details." }, { status: 409 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Payments are not configured on this server yet." },
      { status: 503 },
    );
  }

  try {
    const { payoutCents } = splitAmount(deal.amountCents);
    const transfer = await stripe.transfers.create({
      amount: payoutCents,
      currency: deal.currency,
      destination: deal.stripeConnectAccountId,
      source_transaction: deal.stripeChargeId,
      metadata: { dealId: deal.id },
    });
    updateDeal(deal.id, { status: "released", stripeTransferId: transfer.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      console.error(
        `[deals] Stripe rejected the release transfer (${err.type}${err.code ? `/${err.code}` : ""}):`,
        err.message,
      );
      return NextResponse.json(
        { error: `We could not release the payment: ${err.message}` },
        { status: 502 },
      );
    }
    console.error("[deals] could not release payment:", err);
    return NextResponse.json(
      { error: "We could not release the payment. Please try again." },
      { status: 502 },
    );
  }
}
