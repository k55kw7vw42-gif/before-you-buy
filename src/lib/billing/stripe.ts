import Stripe from "stripe";

export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;

  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20",
  });
}

export function getBillingConfig() {
  const priceId = process.env.STRIPE_PRICE_ID;

  if (!priceId) return null;

  return {
    priceId,
  };
}

// ✅ الحل هنا
export function isBillingConfigured() {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PRICE_ID;
}
