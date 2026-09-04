import Link from "next/link";
import { isDemoMode } from "@/lib/ai";

export default function HomePage() {
  const demo = isDemoMode();

  return (
    <div>
      <section className="hero">
        <p className="tagline">Check before you pay.</p>
        <h1>Before You Pay</h1>
        <p className="lede">
          Upload a screenshot of an offer, message, invoice, listing or payment request and
          we&apos;ll analyse it for potential scam warning signs.
        </p>
        <div className="btn-row" style={{ marginTop: "1.5rem" }}>
          <Link className="btn btn-primary" href="/scan">
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
          <h3>1. Share what you received</h3>
          <p>
            A screenshot of the message, listing or invoice - or just the link someone sent you.
          </p>
        </div>
        <div className="card">
          <h3>2. We look for warning signs</h3>
          <p>
            Unusual payment methods, pressure to pay fast, prices far below market, requests for
            personal details, and more.
          </p>
        </div>
        <div className="card">
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
