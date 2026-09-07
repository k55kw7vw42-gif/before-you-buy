import Link from "next/link";
import type { ScanRecord } from "@/lib/types";
import { verdictLine } from "@/lib/risk/engine";
import { RiskBadge } from "./RiskBadge";
import { ScoreDial } from "./ScoreDial";
import { ShareButton } from "./ShareButton";

const SEVERITY_LABEL: Record<string, string> = {
  high: "Strong signal",
  medium: "Moderate signal",
  low: "Minor signal",
};

/** Purely decorative, alongside the badge - never the only risk indicator. */
const VERDICT_EMOJI: Record<string, string> = {
  low: "✅",
  medium: "⚠️",
  high: "⚠️",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** The full results view, shared by a fresh scan and a history entry. */
export function ScanResult({ scan }: { scan: ScanRecord }) {
  const risky = scan.warningSigns.filter((w) => w.points > 0);
  const mitigating = scan.warningSigns.filter((w) => w.points <= 0);

  return (
    <div className="stack-lg">
      <section className={`card verdict-hero level-${scan.level}`}>
        <div className="verdict-emoji" aria-hidden="true">
          {VERDICT_EMOJI[scan.level]}
        </div>
        <RiskBadge level={scan.level} />
        <div className="score-panel" style={{ marginTop: "1.1rem" }}>
          <ScoreDial score={scan.score} level={scan.level} />
        </div>
        <h1 style={{ marginTop: "1.1rem", fontSize: "1.7rem" }}>Risk Score: {scan.score}/100</h1>
        <p className="verdict-line">{verdictLine(scan.level, risky.length)}</p>

        <div className="share-row">
          <ShareButton score={scan.score} level={scan.level} />
        </div>

        <p className="small muted" style={{ marginTop: "1.5rem", marginBottom: 0 }}>
          {scan.scanType === "link" ? "Link checked" : "Screenshot"}:{" "}
          <span style={{ overflowWrap: "anywhere" }}>{scan.sourceLabel}</span> ·{" "}
          {formatDate(scan.createdAt)}
        </p>
      </section>

      <section className="card">
        <h2>Summary</h2>
        <p style={{ marginBottom: 0 }}>{scan.summary}</p>
      </section>

      <section className="card">
        <h2>Why we flagged this</h2>
        {risky.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            We did not find any of the warning signs we check for. That is not a guarantee that
            this is genuine - it only means nothing stood out to us.
          </p>
        ) : (
          <ul className="sign-list">
            {risky.map((sign, i) => (
              <li key={sign.code}>
                <details className={`sign sev-${sign.severity}`} open={i === 0}>
                  <summary>
                    <div className="sign-title">
                      <span>{sign.title}</span>
                      <span className="points">{SEVERITY_LABEL[sign.severity]}</span>
                      <span className="chev" aria-hidden="true">
                        ›
                      </span>
                    </div>
                  </summary>
                  <p className="sign-detail">{sign.detail}</p>
                </details>
              </li>
            ))}
          </ul>
        )}

        {mitigating.length > 0 && (
          <>
            <h3 style={{ marginTop: "1.5rem" }}>Things that lowered the score</h3>
            <ul className="sign-list">
              {mitigating.map((sign) => (
                <li key={sign.code}>
                  <details className="sign sev-low">
                    <summary>
                      <div className="sign-title">
                        <span>{sign.title}</span>
                        <span className="points">Lowers risk</span>
                        <span className="chev" aria-hidden="true">
                          ›
                        </span>
                      </div>
                    </summary>
                    <p className="sign-detail">{sign.detail}</p>
                  </details>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <h2>What you should do next</h2>
        <ol className="action-list">
          {scan.recommendations.map((rec) => (
            <li key={rec}>{rec}</li>
          ))}
        </ol>
      </section>

      {scan.fields.length > 0 && (
        <section className="card">
          <h2>Information we extracted</h2>
          <dl className="kv">
            {scan.fields.map((field, i) => (
              <div key={field.key}>
                {i > 0 && <span className="row-sep" />}
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {scan.notes.length > 0 && (
        <section className="card card-flat">
          <h3>Limits of this check</h3>
          <ul className="action-list small muted">
            {scan.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="btn-row">
        <Link className="btn btn-primary" href="/scan">
          Scan another screenshot
        </Link>
        <Link className="btn btn-secondary" href="/link">
          Check a link
        </Link>
      </div>

      <p className="disclaimer">
        Before You Pay looks for common warning signs. It cannot confirm that an offer is genuine
        or prove that it is fraudulent, and a low score is not an endorsement. Always verify a
        seller independently before you send money.
      </p>
    </div>
  );
}
