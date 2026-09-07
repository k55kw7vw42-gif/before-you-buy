import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Script from "next/script";
import { BottomNav } from "@/components/BottomNav";
import { SiteHeader } from "@/components/SiteHeader";
import { adsenseClientId, areAdsEnabled } from "@/lib/ads";
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
