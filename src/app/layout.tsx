import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { BottomNav } from "@/components/BottomNav";
import { SiteHeader } from "@/components/SiteHeader";
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
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main className="page">{children}</main>
        <footer className="site-footer">
          Before You Pay highlights common scam warning signs. It cannot confirm that an offer is
          genuine or prove that it is fraudulent - always verify a seller independently before you
          send money. <Link href="/">Home</Link>
        </footer>
        <BottomNav />
      </body>
    </html>
  );
}
