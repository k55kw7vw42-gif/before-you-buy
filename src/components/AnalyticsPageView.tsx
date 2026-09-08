"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { trackPageView } from "@/lib/analytics";

/**
 * Fires a GA4 page_view on the initial load and on every client-side route
 * change. The Next.js App Router does not reload the page for a <Link>
 * navigation, so gtag's own automatic pageview (which only fires once, on
 * the initial script load) would miss every subsequent page. The gtag
 * config call in the root layout sets send_page_view: false so this effect
 * is the single source of every page_view, including the first - not an
 * addition on top of an automatic one, which would double the first page.
 *
 * Reads the current URL from `window.location` inside the effect, rather
 * than also depending on useSearchParams(), so this component does not need
 * a <Suspense> boundary - it lives in the root layout, above every route.
 */
export function AnalyticsPageView() {
  const pathname = usePathname();

  useEffect(() => {
    trackPageView({
      page_path: pathname,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname]);

  return null;
}
