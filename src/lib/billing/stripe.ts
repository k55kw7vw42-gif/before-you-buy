import Stripe from "stripe";

export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;

  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-08-26.dahlia", // ✅ حل error
  });
}

export function getBillingConfig() {
  const priceId = process.env.STRIPE_PRICE_ID;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!priceId || !webhookSecret) return null; // ✅ مهم جدا

  return {
    priceId,
    webhookSecret,
  };
}

// ✅ مهم عشان errors اللي عندك
export function isBillingConfigured(): boolean {
  return (
    !!process.env.STRIPE_SECRET_KEY &&
    !!process.env.STRIPE_PRICE_ID &&
    !!process.env.STRIPE_WEBHOOK_SECRET
  );
}
