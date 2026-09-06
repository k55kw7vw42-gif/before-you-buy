import Link from "next/link";
import { PLANS } from "@/lib/billing/plans";

/**
 * Shown in place of the uploader when nobody is signed in. Screenshot analysis
 * calls the vision model, so it is for account holders; link checks stay open.
 */
export function SignInToScan() {
  return (
    <section className="card">
      <span className="badge risk-low">
        <span className="dot" aria-hidden="true" />
        Free account
      </span>
      <h2 style={{ marginTop: "0.75rem" }}>Create an account to scan a screenshot</h2>
      <p className="muted">
        Scanning reads your screenshot with an AI model, so it needs an account. It is free -
        you get {PLANS.free.monthlyScans} screenshot analyses a month, and your scan history
        stays private to you.
      </p>

      <div className="btn-row" style={{ marginTop: "1.25rem" }}>
        <Link className="btn btn-primary" href="/signup?next=/scan">
          Create a free account
        </Link>
        <Link className="btn btn-secondary" href="/login?next=/scan">
          Log in
        </Link>
      </div>

      <p className="small muted" style={{ marginTop: "1.25rem", marginBottom: 0 }}>
        Want to try something first? <Link href="/link">Checking a link</Link> is free, unlimited
        and needs no account.
      </p>
    </section>
  );
}
