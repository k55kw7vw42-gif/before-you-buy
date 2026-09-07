import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getBillingConfig, getStripe } from "@/lib/billing/stripe";
import {
  applyStripeSubscription,
  claimBillingEvent,
  findUserByCustomerId,
  releaseBillingEvent,
} from "@/lib/billing/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const stripe = getStripe();
  const config = getBillingConfig();

  if (!stripe || !config) {
    console.error("[billing] webhook received but Stripe is not configured");
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  // ✅ مهم: تأكد إن webhookSecret موجود
  if (!config.webhookSecret) {
    console.error("[billing] missing webhook secret");
    return NextResponse.json({ error: "Missing webhook secret." }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;

  try {
    // ✅ كده TypeScript مش هيشتكي
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.webhookSecret
    );
  } catch (err) {
    console.error(
      "[billing] rejected a webhook with an invalid signature:",
      err instanceof Error ? err.message : "unknown error"
    );
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // منع التكرار
  if (!claimBillingEvent(event.id, event.type)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(stripe, event);
  } catch (err) {
    console.error(`[billing] failed to apply ${event.type}:`, err);
    releaseBillingEvent(event.id);
    return NextResponse.json({ error: "Could not process event." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(stripe: Stripe, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;

      const userId =
        session.client_reference_id ??
        session.metadata?.userId ??
        null;

      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;

      if (!userId || !subscriptionId) {
        console.error("[billing] missing user or subscription id");
        return;
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      applyStripeSubscription(userId, subscription);
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;

      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id;

      const userId =
        subscription.metadata?.userId ??
        (customerId ? findUserByCustomerId(customerId) : null);

      if (!userId) {
        console.error(`[billing] ${event.type} for unknown user`);
        return;
      }

      applyStripeSubscription(userId, subscription);
      return;
    }

    default:
      return;
  }
}
