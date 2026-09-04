import Stripe from "stripe";

/**
 * Stripe client factory. Every value is read from the server environment; no
 * Stripe key of any kind is exposed to the browser, because the app uses hosted
 * Checkout (the server creates a session and returns a URL to redirect to)
 * rather than Stripe.js.
 */

let cached: Stripe | null = null;

export interface BillingConfig {
  secretKey: string;
  priceId: string;
  webhookSecret: string;
}

/** Reads billing config, or null when the app is not set up for payments. */
export function getBillingConfig(): BillingConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const priceId = process.env.STRIPE_PRICE_ID?.trim();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secretKey || !priceId || !webhookSecret) return null;
  return { secretKey, priceId, webhookSecret };
}

/** True when STRIPE_SECRET_KEY, STRIPE_PRICE_ID and STRIPE_WEBHOOK_SECRET are all set. */
export function isBillingConfigured(): boolean {
  return getBillingConfig() !== null;
}

/**
 * STRIPE_API_BASE exists so the tests can point the SDK at a local stub. Leave
 * it unset in every real environment.
 */
function hostOptionsFromEnv(): Partial<Stripe.StripeConfig> {
  const override = process.env.STRIPE_API_BASE?.trim();
  if (!override) return {};
  try {
    const url = new URL(override);
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      protocol: url.protocol === "http:" ? "http" : "https",
    };
  } catch {
    console.error("[billing] STRIPE_API_BASE is not a valid URL; ignoring it");
    return {};
  }
}

/**
 * Builds a client from a secret key alone. The app uses `getStripe()`, which
 * also needs a price and a webhook secret; a maintenance script that only reads
 * from Stripe has no use for either.
 */
export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { ...hostOptionsFromEnv(), maxNetworkRetries: 2 });
}

export function getStripe(): Stripe | null {
  const config = getBillingConfig();
  if (!config) return null;
  if (cached) return cached;

  cached = createStripeClient(config.secretKey);
  return cached;
}

/**
 * Absolute base URL for Checkout return links. Prefers APP_URL (needed behind a
 * proxy that rewrites the host) and otherwise trusts the request's own origin.
 */
export function appBaseUrl(request: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}
