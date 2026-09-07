import Stripe from "stripe";

export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;

  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-08-26.dahlia", // ✅ حل المشكلة
  });
}

export function getBillingConfig() {
  const priceId = process.env.STRIPE_PRICE_ID;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!priceId) return null;

  return {
    priceId,
    webhookSecret,
  };
}

export function isBillingConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PRICE_ID;
}
