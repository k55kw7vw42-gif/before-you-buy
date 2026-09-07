"use client";

import { useEffect } from "react";
import type { CSSProperties } from "react";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * A single AdSense ad unit. The loader script (in the root layout) is the
 * one place that decides whether ads are enabled at all - this component
 * only needs the publisher id to render its <ins> tag, so it renders nothing
 * if that id is not configured, rather than showing a broken ad slot.
 *
 * The client id comes from a NEXT_PUBLIC_ env var, which Next.js inlines as
 * the same literal string in both the server-rendered HTML and the client
 * bundle - so this check produces identical output on the server and on
 * first client render, and never causes a hydration mismatch. The actual
 * ad request only happens after mount, inside useEffect, since it touches
 * `window` and talks to Google's ad server.
 */
export function AdBanner({
  slot,
  format = "auto",
  className,
  style,
}: {
  /** The AdSense ad unit's slot id (data-ad-slot), from the AdSense dashboard. */
  slot: string;
  format?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;

  useEffect(() => {
    if (!clientId) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (err) {
      console.error("[ads] adsbygoogle push failed:", err);
    }
  }, [clientId, slot]);

  if (!clientId) return null;

  return (
    <ins
      className={["adsbygoogle", className].filter(Boolean).join(" ")}
      style={{ display: "block", ...style }}
      data-ad-client={clientId}
      data-ad-slot={slot}
      data-ad-format={format}
      data-full-width-responsive="true"
    />
  );
}
