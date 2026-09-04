import type { AnalysisExtraction, ExtractedField, SignalObservation } from "@/lib/types";
import { SIGNALS_BY_CODE } from "@/lib/risk/signals";

function asString(value: unknown, max = 600): string {
  if (typeof value === "string") return value.trim().slice(0, max);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function titleCase(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Pulls the JSON object out of a model response that may be fenced or padded. */
function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error("Model response did not contain a JSON object");
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

/**
 * Normalises whatever the model returned into our own shape. Anything we do not
 * recognise is dropped: the model cannot introduce new signal codes, and every
 * string is length-capped before it reaches the database or the page.
 */
export function parseExtraction(raw: string): AnalysisExtraction {
  const data = extractJsonObject(raw) as Record<string, unknown>;

  const fields: ExtractedField[] = [];
  const rawFields = Array.isArray(data.fields) ? data.fields : [];
  for (const entry of rawFields) {
    if (!entry || typeof entry !== "object") continue;
    const f = entry as Record<string, unknown>;
    const key = asString(f.key, 60);
    const value = asString(f.value, 800);
    if (!key || !value) continue;
    if (fields.some((existing) => existing.key === key)) continue;
    fields.push({ key, label: asString(f.label, 80) || titleCase(key), value });
    if (fields.length >= 20) break;
  }

  const observations: SignalObservation[] = [];
  const rawObs = Array.isArray(data.observations) ? data.observations : [];
  for (const entry of rawObs) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const code = asString(o.code, 60);
    if (!SIGNALS_BY_CODE.has(code)) continue;
    // Repeats are kept: the risk engine merges them into a single, stronger
    // warning sign rather than letting the first one win.
    const confidence =
      typeof o.confidence === "number" && Number.isFinite(o.confidence)
        ? Math.min(1, Math.max(0, o.confidence))
        : 0.5;
    observations.push({ code, confidence, evidence: asString(o.evidence, 400) });
    if (observations.length >= 25) break;
  }

  const notes = (Array.isArray(data.notes) ? data.notes : [])
    .map((n) => asString(n, 300))
    .filter(Boolean)
    .slice(0, 5);

  return {
    summary: asString(data.summary, 500) || "We could not read enough detail to describe this material.",
    fields,
    observations,
    notes,
  };
}
