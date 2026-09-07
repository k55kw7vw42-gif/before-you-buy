import Link from "next/link";
import { isDemoMode } from "@/lib/ai";

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15V4M7 9l5-5 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m20 20-4.3-4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function ShieldCheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5 4.5 5.6v6c0 4.7 3.2 8.4 7.5 9.9 4.3-1.5 7.5-5.2 7.5-9.9v-6L12 2.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="m8.8 12.1 2.2 2.2 4.2-4.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function HomePage() {
  const demo = isDemoMode();

  return (
    <div>
      <section className="hero">
        <span className="tagline">Check before you pay</span>
        <h1>Know before you send the money.</h1>
        <p className="lede">
          Upload a screenshot of an offer, message, invoice, listing or payment request and
          we&apos;ll analyse it for potential scam warning signs — in seconds, before you pay.
        </p>
        <div className="btn-row" style={{ marginTop: "1.75rem" }}>
          <Link className="btn btn-primary btn-hero" href="/scan">
            Scan Screenshot
          </Link>
          <Link className="btn btn-secondary" href="/link">
            Check a Link
          </Link>
        </div>
        {demo && (
          <p className="notice-strip" style={{ marginTop: "1.5rem", maxWidth: "34rem" }}>
            Running in demo mode: no AI provider is configured, so screenshots are not actually
            read. Set <code>ANTHROPIC_API_KEY</code> to enable real image analysis.
          </p>
        )}
      </section>

      <section className="feature-grid">
        <div className="card">
          <div className="feature-icon">
            <UploadIcon />
          </div>
          <h3>1. Share what you received</h3>
          <p>
            A screenshot of the message, listing or invoice - or just the link someone sent you.
          </p>
        </div>
        <div className="card">
          <div className="feature-icon">
            <SearchIcon />
          </div>
          <h3>2. We look for warning signs</h3>
          <p>
            Unusual payment methods, pressure to pay fast, prices far below market, requests for
            personal details, and more.
          </p>
        </div>
        <div className="card">
          <div className="feature-icon">
            <ShieldCheckIcon />
          </div>
          <h3>3. You get a clear next step</h3>
          <p>
            A risk score from 0 to 100, what we flagged and why, and what to check before you send
            any money.
          </p>
        </div>
      </section>

      <section className="card" style={{ marginTop: "2rem" }}>
        <h2>What this tool does and does not do</h2>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Before You Pay points out patterns that often appear in scams so you can check them
          yourself. It cannot verify that a seller is real, and it cannot prove that anyone is
          committing fraud. A low score is not an endorsement - treat every result as a prompt to
          verify, not a verdict.
        </p>
      </section>
    </div>
  );
}
