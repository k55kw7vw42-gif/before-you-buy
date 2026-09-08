import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Script from "next/script";
import { AnalyticsPageView } from "@/components/AnalyticsPageView";
import { BottomNav } from "@/components/BottomNav";
import { SiteHeader } from "@/components/SiteHeader";
import { adsenseClientId, areAdsEnabled } from "@/lib/ads";
import { gaMeasurementId } from "@/lib/analytics";
import "./globals.css";

export const metadata: Metadata = {
  title: "Before You Pay - Check before you pay",
  description:
    "Upload a screenshot of an offer, message, invoice, listing or payment request and we'll analyse it for potential scam warning signs.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#07080f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const clientId = adsenseClientId();
  const showAdsenseScript = areAdsEnabled() && !!clientId;
  const gaId = gaMeasurementId();

  return (
    <html lang="en">
      <body>
        {showAdsenseScript && (
          <Script
            id="adsbygoogle-loader"
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`}
            crossOrigin="anonymous"
            strategy="afterInteractive"
          />
        )}
        {gaId && (
          <>
            <Script
              id="ga4-loader"
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
              strategy="afterInteractive"
            />
            {/* send_page_view: false - AnalyticsPageView below sends every
                page_view, including the first, so gtag's own automatic one
                (which fires once on script load) never double-counts it. */}
            <Script id="ga4-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                window.gtag = gtag;
                gtag('js', new Date());
                gtag('config', '${gaId}', { send_page_view: false });
              `}
            </Script>
            <AnalyticsPageView />
          </>
        )}
        <SiteHeader />

        <main className="page">{children}</main>

        {/* ✅ Footer updated */}
        <footer className="site-footer">
          <p>
            Before You Pay highlights common scam warning signs. It cannot confirm that an offer is
            genuine or prove that it is fraudulent — always verify a seller independently before you
            send money.
          </p>

          <div style={{ marginTop: "10px" }}>
            <Link href="/">Home</Link> {" • "}
            <Link href="/privacy">Privacy</Link> {" • "}
            <Link href="/terms">Terms</Link>
          </div>
        </footer>

        <BottomNav />
      </body>
    </html>
  );
}
