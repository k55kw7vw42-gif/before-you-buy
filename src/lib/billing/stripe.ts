import Stripe from "stripe";

export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;

  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    // 🔥 حل مشكلة version
    apiVersion: "2026-08-26.dahlia" as any,
  });
}

export function getBillingConfig() {
  const priceId = process.env.STRIPE_PRICE_ID;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!priceId || !webhookSecret) return null;

  return {
    priceId,
    webhookSecret,
  };
}

// ✅ ده المهم جدًا (كان ناقص أو مش معمول export صح)
export function isBillingConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PRICE_ID;
}
