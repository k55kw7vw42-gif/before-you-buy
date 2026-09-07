/**
 * Central switch for Google AdSense. Ads are opt-in: unless ADS_ENABLED is
 * exactly "true", the loader script never renders and no ad unit shows -
 * matches how the rest of the app fails closed on optional third-party
 * integrations (see isBillingConfigured in lib/billing/stripe.ts).
 */
export function areAdsEnabled(): boolean {
  return process.env.ADS_ENABLED === "true";
}

/**
 * The AdSense publisher id, needed on both the loader script and every ad
 * unit. NEXT_PUBLIC_ is correct here (not a mistake to "fix"): this id is not
 * a secret - it is visible in the page source of any site that runs AdSense -
 * and the client-side AdBanner component needs it in the browser bundle to
 * build its <ins> tag.
 */
export function adsenseClientId(): string | null {
  const id = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID?.trim();
  return id ? id : null;
}
