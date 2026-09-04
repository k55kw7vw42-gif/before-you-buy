import type {
  RiskLevel,
  RiskResult,
  SignalObservation,
  WarningSign,
} from "@/lib/types";
import { SIGNALS_BY_CODE, type SignalDefinition } from "./signals";

/** Score bands from the product spec. */
export function levelForScore(score: number): RiskLevel {
  if (score <= 30) return "low";
  if (score <= 60) return "medium";
  return "high";
}

export const LEVEL_LABEL: Record<RiskLevel, string> = {
  low: "Low Risk",
  medium: "Medium Risk",
  high: "High Risk",
};

const BASELINE_ADVICE: Record<RiskLevel, string[]> = {
  low: [
    "We did not find strong warning signs, but this is not a guarantee. Verify the seller independently before you pay.",
    "Pay with a method that offers buyer protection, such as a credit card or a platform checkout.",
    "Keep a copy of the listing, the conversation and the receipt.",
  ],
  medium: [
    "Do not pay yet. Verify the seller independently before sending any money.",
    "Look up the business or person yourself - search the name, the phone number and the account details separately.",
    "Use a payment method with buyer protection, and never a gift card, crypto or a friends-and-family transfer.",
  ],
  high: [
    "Do not send money yet. Verify the seller independently and use a payment method with buyer protection.",
    "Do not share passwords, one-time codes or full card details with whoever sent this.",
    "If this claims to be a company you deal with, contact them using a number from their official website - not the one in this message.",
    "If you have already paid, contact your bank or card provider right away and report it to your national fraud reporting service.",
  ],
};

/** Extra points per risk signal beyond the second, and the cap on that bonus. */
const CORROBORATION_STEP = 6;
const CORROBORATION_CAP = 18;
/** Confidence at which a signal's `criticalFloor` starts to apply. */
const CRITICAL_CONFIDENCE = 0.7;
/** How much each repeat finding of the same signal raises its confidence. */
const REPEAT_CONFIDENCE_STEP = 0.1;
const MAX_MERGED_CONFIDENCE = 0.95;

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0.5;
  return Math.min(1, Math.max(0, n));
}

/**
 * Turns the analyser's raw observations into a 0-100 score plus the
 * human-readable warning signs and next steps shown on the results page.
 *
 * Scoring is deliberately deterministic and lives outside the AI provider, so
 * swapping providers cannot silently change how risk is calculated.
 */
export function assessRisk(observations: SignalObservation[]): RiskResult {
  // Several distinct findings can share a signal code - a domain can be a
  // throwaway TLD *and* stack subdomains *and* pad hyphens, all of which are
  // "suspicious_url". Merge them into one entry rather than keeping whichever
  // happened to arrive first: take the strongest confidence, nudge it up for
  // each additional independent finding, and keep the evidence together.
  const merged = new Map<string, { def: SignalDefinition; confidence: number; evidence: string[] }>();

  for (const obs of observations) {
    const def = SIGNALS_BY_CODE.get(obs.code);
    // Unknown codes are dropped rather than trusted - the provider does not get
    // to invent new scoring rules.
    if (!def) continue;

    const confidence = clampConfidence(obs.confidence);
    // Very low confidence observations are noise; ignore them entirely.
    if (confidence < 0.25) continue;

    const evidence = obs.evidence?.trim();
    const existing = merged.get(def.code);
    if (!existing) {
      merged.set(def.code, { def, confidence, evidence: evidence ? [evidence] : [] });
      continue;
    }
    existing.confidence = Math.min(
      MAX_MERGED_CONFIDENCE,
      Math.max(existing.confidence, confidence) + REPEAT_CONFIDENCE_STEP,
    );
    if (evidence && !existing.evidence.includes(evidence) && existing.evidence.length < 3) {
      existing.evidence.push(evidence);
    }
  }

  const scored = [...merged.values()].map((entry) => ({
    def: entry.def,
    confidence: entry.confidence,
    detail: entry.evidence.join(" ") || entry.def.description,
    points: Math.round(entry.def.weight * entry.confidence),
  }));

  const risky = scored.filter((s) => s.points > 0);
  const raw = scored.reduce((sum, s) => sum + s.points, 0);

  // Independent warning signs corroborate one another: three unrelated signs in
  // the same message mean more than the sum of three isolated ones.
  const corroboration = Math.min(CORROBORATION_CAP, Math.max(0, risky.length - 2) * CORROBORATION_STEP);

  // Some signals are decisive on their own. A confident observation of one
  // raises the score to at least its floor, however little else was found.
  const floor = scored.reduce((highest, s) => {
    const f = s.def.criticalFloor;
    return f && s.confidence >= CRITICAL_CONFIDENCE ? Math.max(highest, f) : highest;
  }, 0);

  const score = Math.min(100, Math.max(0, Math.max(raw + corroboration, floor)));
  const level = levelForScore(score);

  // Risk-increasing signals first, strongest first; mitigating signals last.
  const warningSigns: WarningSign[] = scored
    .slice()
    .sort((a, b) => b.points - a.points)
    .map(({ def, detail, points }) => ({
      code: def.code,
      title: def.title,
      detail,
      severity: def.severity,
      points,
    }));

  const recommendations: string[] = [];
  const pushUnique = (text: string) => {
    if (!recommendations.includes(text)) recommendations.push(text);
  };

  BASELINE_ADVICE[level].forEach(pushUnique);
  risky
    .slice()
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .forEach((s) => pushUnique(s.def.advice));

  return { score, level, warningSigns, recommendations };
}

/**
 * One-line, hedged verdict used above the detail on the results page.
 * Never asserts that something is a scam.
 */
export function verdictLine(level: RiskLevel, warningCount: number): string {
  const signs = warningCount === 1 ? "1 warning sign" : `${warningCount} warning signs`;
  switch (level) {
    case "high":
      return `Potential risk detected - we found ${signs} that are common in scams. Verify this seller before paying.`;
    case "medium":
      return `Warning signs found - we found ${signs} worth checking. Verify this seller before paying.`;
    default:
      return warningCount === 0
        ? "No strong warning signs found. This is not a guarantee - still verify the seller before you pay."
        : `Only minor warning signs found (${signs}). This is not a guarantee - still verify the seller before you pay.`;
  }
}
