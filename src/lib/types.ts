/** Shared domain types for scanning, risk analysis and persistence. */

export type RiskLevel = "low" | "medium" | "high";

export type ScanType = "screenshot" | "link";

/** A single structured field the analyser pulled out of the source material. */
export interface ExtractedField {
  key: string;
  label: string;
  value: string;
}

/**
 * A scam signal the analyser believes is present.
 * `confidence` (0-1) scales the signal's weight, so a hesitant observation
 * moves the score less than a clear-cut one.
 */
export interface SignalObservation {
  code: string;
  confidence: number;
  evidence: string;
}

/** A signal after the risk engine has scored it. */
export interface WarningSign {
  code: string;
  title: string;
  detail: string;
  severity: RiskLevel;
  points: number;
}

export interface RiskResult {
  score: number;
  level: RiskLevel;
  warningSigns: WarningSign[];
  recommendations: string[];
}

/** What every AI provider must return; the risk engine takes it from here. */
export interface AnalysisExtraction {
  summary: string;
  fields: ExtractedField[];
  observations: SignalObservation[];
  /** Provider-side caveats, e.g. "image was low resolution". */
  notes: string[];
}

export interface ScanRecord {
  id: string;
  scanType: ScanType;
  sourceLabel: string;
  summary: string;
  score: number;
  level: RiskLevel;
  provider: string;
  createdAt: string;
  fields: ExtractedField[];
  warningSigns: WarningSign[];
  recommendations: string[];
  notes: string[];
}

export interface ScanSummaryRecord {
  id: string;
  scanType: ScanType;
  sourceLabel: string;
  summary: string;
  score: number;
  level: RiskLevel;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  email: string;
  createdAt: string;
}
