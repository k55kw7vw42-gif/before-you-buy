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

export function getStripe(): Stripe | null {
  const config = getBillingConfig();
  if (!config) return null;
  if (cached) return cached;

  // STRIPE_API_BASE exists so the billing tests can point the SDK at a local
  // stub. Leave it unset in every real environment.
  const override = process.env.STRIPE_API_BASE?.trim();
  let hostOptions: Partial<Stripe.StripeConfig> = {};
  if (override) {
    try {
      const url = new URL(override);
      hostOptions = {
        host: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        protocol: url.protocol === "http:" ? "http" : "https",
      };
    } catch {
      console.error("[billing] STRIPE_API_BASE is not a valid URL; ignoring it");
    }
  }

  cached = new Stripe(config.secretKey, { ...hostOptions, maxNetworkRetries: 2 });
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
