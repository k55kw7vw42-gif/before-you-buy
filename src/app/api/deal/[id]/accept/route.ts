import { NextResponse } from "next/server";
import Stripe from "stripe";
import { baseUrl } from "@/lib/base-url";
import { getStripe } from "@/lib/billing/stripe";
import { getDeal, updateDeal } from "@/lib/deals/store";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The seller accepting a deal. Not gated behind sign-in - the seller need
 * not have an account with this app at all, only the link the buyer sent
 * them. Creates (or resumes) a Stripe Connect Express account for them and
 * returns Stripe's own hosted onboarding URL; no bank or identity details
 * ever pass through this app's own servers.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const limit = checkRateLimit(`deal-accept:${rateLimitKey(request, null)}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const deal = getDeal(id);
  if (!deal) {
    return NextResponse.json({ error: "Deal not found." }, { status: 404 });
  }
  if (deal.status !== "pending_seller" && deal.status !== "seller_onboarding") {
    return NextResponse.json({ error: "This deal is not waiting for a seller." }, { status: 409 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Payments are not configured on this server yet." },
      { status: 503 },
    );
  }

  try {
    let accountId = deal.stripeConnectAccountId;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: deal.sellerEmail,
        capabilities: { transfers: { requested: true } },
      });
      accountId = account.id;
      updateDeal(deal.id, { stripeConnectAccountId: accountId, status: "seller_onboarding" });
    }

    const base = baseUrl();
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${base}/deal/${deal.id}?onboarding=refresh`,
      return_url: `${base}/deal/${deal.id}?onboarding=return`,
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      console.error(
        `[deals] Stripe rejected seller onboarding (${err.type}${err.code ? `/${err.code}` : ""}):`,
        err.message,
      );
      return NextResponse.json(
        { error: `We could not start seller onboarding: ${err.message}` },
        { status: 502 },
      );
    }
    console.error("[deals] could not start seller onboarding:", err);
    return NextResponse.json(
      { error: "We could not start seller onboarding. Please try again." },
      { status: 502 },
    );
  }
}
