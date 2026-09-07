import { NextResponse } from "next/server";
import { getStripe, getBillingConfig } from "@/lib/billing/stripe";

export async function POST() {
  const stripe = getStripe();
  const config = getBillingConfig();

  if (!stripe || !config) {
    return NextResponse.json(
      { error: "Payments are not configured on this server yet." },
      { status: 503 }
    );
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: config.priceId,
          quantity: 1,
        },
      ],
      success_url: "https://beforeyoupay.onrender.com/success",
      cancel_url: "https://beforeyoupay.onrender.com/pricing",
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Stripe error" },
      { status: 500 }
    );
  }
}
