import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { baseUrl } from "@/lib/base-url";
import { getStripe } from "@/lib/billing/stripe";
import { getSubscription } from "@/lib/billing/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe's own billing portal, where a subscriber can update their card or
 * cancel. Managing a subscription is Stripe's job, not ours.
 */
export async function POST(_request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const stripe = getStripe();
  const customerId = getSubscription(user.id)?.stripeCustomerId;
  if (!stripe || !customerId) {
    return NextResponse.json({ error: "No billing account found." }, { status: 404 });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl()}/account`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing] could not open the billing portal:", err);
    return NextResponse.json(
      { error: "We could not open the billing portal. Please try again." },
      { status: 502 },
    );
  }
}
