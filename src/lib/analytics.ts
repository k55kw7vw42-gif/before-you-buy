declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** GA4 measurement id. Not a secret - visible in every page's network requests. */
export function gaMeasurementId(): string | null {
  const id = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim();
  return id ? id : null;
}

/**
 * Sends a gtag event. Safe to call from anywhere, including before the
 * remote gtag.js script has finished loading: the inline shim defined in the
 * root layout makes window.gtag available immediately and just queues calls
 * onto window.dataLayer, which the real script drains once it arrives - so
 * nothing is lost by calling this early. A no-op during SSR and whenever GA
 * is not configured (window.gtag is never defined in that case).
 */
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", name, params);
}

export function trackPageView(params: {
  page_path: string;
  page_location: string;
  page_title: string;
}): void {
  trackEvent("page_view", params);
}
