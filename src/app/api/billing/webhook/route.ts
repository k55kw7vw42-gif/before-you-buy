import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getBillingConfig, getStripe } from "@/lib/billing/stripe";
import {
  applyStripeSubscription,
  claimBillingEvent,
  findUserByCustomerId,
  releaseBillingEvent,
} from "@/lib/billing/subscription";
import { applyDealPayment } from "@/lib/deals/store";
// Aliased: SafeSwap (a separate, independent escrow feature) has its own
// function of the same name in its own module - keeping both imports
// explicit here avoids any ambiguity about which one is being called.
import { applyDealPayment as applySafeSwapPayment } from "@/lib/safeswap/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook. This is what makes a subscription real: the app never marks
 * anyone Pro because the browser said so, only because a Stripe-signed event
 * said so.
 *
 * The raw request body is required - the signature is computed over the exact
 * bytes Stripe sent, so it must not be parsed or re-serialised first.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  const config = getBillingConfig();
  if (!stripe || !config) {
    console.error("[billing] webhook received but Stripe is not configured");
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret);
  } catch (err) {
    // An unverified payload is discarded outright: anyone can POST here.
    console.error(
      "[billing] rejected a webhook with an invalid signature:",
      err instanceof Error ? err.message : "unknown error",
    );
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // Stripe retries deliveries, so the same event can arrive more than once.
  if (!claimBillingEvent(event.id, event.type)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(stripe, event);
  } catch (err) {
    console.error(`[billing] failed to apply ${event.type}:`, err);
    // Give up the claim so Stripe's redelivery is not mistaken for a duplicate
    // and skipped; 500 asks Stripe to retry.
    releaseBillingEvent(event.id);
    return NextResponse.json({ error: "Could not process event." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(stripe: Stripe, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      // A Deal Protection payment (one-time, mode "payment") is a distinct
      // flow from the Pro subscription checkout below (mode "subscription")
      // - both land on this same endpoint, so metadata is what tells them
      // apart. This branch never touches subscription state.
      if (session.metadata?.kind === "deal" && session.metadata?.dealId) {
        await applyDealPayment(stripe, session.metadata.dealId, session);
        return;
      }

      const userId = session.client_reference_id ?? session.metadata?.userId ?? null;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (!userId || !subscriptionId) {
        console.error("[billing] checkout.session.completed without a user or subscription id");
        return;
      }
      // Re-read the subscription from Stripe rather than trusting the session
      // payload for status and period.
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      applyStripeSubscription(userId, subscription);
      return;
    }

    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;

      // Checkout Sessions (Pro subscriptions, Deal Protection) also create a
      // PaymentIntent under the hood, so this event fires for those too -
      // only SafeSwap tags its own with this metadata, so anything else is
      // safely ignored here rather than acted on.
      if (paymentIntent.metadata?.system !== "safeswap") return;

      const dealId = paymentIntent.metadata?.dealId;
      const buyerId = paymentIntent.metadata?.buyerId;
      if (!dealId || !buyerId) {
        console.error("[safeswap] payment_intent.succeeded without dealId/buyerId metadata");
        return;
      }
      applySafeSwapPayment(dealId, buyerId);
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
      const userId =
        subscription.metadata?.userId ?? (customerId ? findUserByCustomerId(customerId) : null);
      if (!userId) {
        console.error(`[billing] ${event.type} for an unknown customer`);
        return;
      }
      applyStripeSubscription(userId, subscription);
      return;
    }

    default:
      // Everything else is acknowledged and ignored.
      return;
  }
}
