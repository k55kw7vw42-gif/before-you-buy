#!/usr/bin/env node
/**
 * Unit checks for the pure logic that the HTTP smoke test cannot reach: the
 * parser that normalises an AI provider's reply, and the risk scoring bands.
 *
 *   npm run test:unit
 *
 * Runs the TypeScript sources directly through Node's type stripping, with a
 * resolve hook for the `@/` path alias.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(resolvePath(ROOT, "scripts/ts-alias-hook.mjs")));

const { parseExtraction } = await import(pathToFileURL(resolvePath(ROOT, "src/lib/ai/parse.ts")).href);
const { assessRisk } = await import(pathToFileURL(resolvePath(ROOT, "src/lib/risk/engine.ts")).href);

let pass = 0, fail = 0;
const t = (name, cond, got) => { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name + (got !== undefined ? " -> " + JSON.stringify(got) : "")); } };

console.log("parseExtraction");
// A realistic model reply, wrapped in a markdown fence with chatter around it.
const realistic = 'Here is the analysis:\n```json\n' + JSON.stringify({
  summary: "This appears to be a marketplace listing for a laptop with a payment request.",
  fields: [
    { key: "seller_name", label: "Seller", value: "Dave M." },
    { key: "product_or_service", label: "Product", value: "MacBook Pro 16\" M3" },
    { key: "price", label: "Price", value: "$420" },
    { key: "payment_method", label: "Payment method", value: "Zelle" },
    { key: "seller_name", label: "Duplicate", value: "should be dropped" },
    { key: "", label: "no key", value: "dropped" },
  ],
  observations: [
    { code: "unrealistic_price", confidence: 0.9, evidence: "A $420 price for a current MacBook Pro is far below market." },
    { code: "unusual_payment_method", confidence: 0.8, evidence: "Payment is requested by Zelle, which has no buyer protection." },
    { code: "urgency_pressure", confidence: 0.7, evidence: "The seller says the listing ends tonight." },
    { code: "made_up_signal", confidence: 1.0, evidence: "invented code that must be ignored" },
    { code: "unrealistic_price", confidence: 0.2, evidence: "duplicate, must be ignored" },
    { code: "suspicious_wording", confidence: 0.1, evidence: "below the noise floor" },
  ],
  notes: ["Part of the message was cut off at the bottom."],
}) + '\n```\nLet me know if you need more.';

const parsed = parseExtraction(realistic);
t("keeps the summary", parsed.summary.startsWith("This appears to be"));
t("drops duplicate and keyless fields", parsed.fields.length === 4, parsed.fields.map(f => f.key));
t("drops invented signal codes", !parsed.observations.some(o => o.code === "made_up_signal"), parsed.observations.map(o => o.code));
t("keeps repeat observations for the engine to merge", parsed.observations.filter(o => o.code === "unrealistic_price").length === 2);
t("keeps the notes", parsed.notes.length === 1);

const risk = assessRisk(parsed.observations);
t("low-confidence observation is excluded from scoring", !risk.warningSigns.some(w => w.code === "suspicious_wording"));
t("underpriced + bad payment + urgency scores medium or high", risk.score > 30, risk.score);
t("score stays within 0-100", risk.score >= 0 && risk.score <= 100, risk.score);

// Bare JSON with no fence.
t("parses unfenced JSON", parseExtraction('{"summary":"hi","fields":[],"observations":[],"notes":[]}').summary === "hi");
// Garbage.
let threw = false; try { parseExtraction("I cannot help with that."); } catch { threw = true; }
t("throws on a non-JSON reply", threw);
// Missing keys entirely.
const sparse = parseExtraction('{"summary":"only a summary"}');
t("tolerates missing arrays", sparse.fields.length === 0 && sparse.observations.length === 0);
// Overlong strings are capped.
const long = parseExtraction(JSON.stringify({ summary: "x".repeat(5000), fields: [], observations: [], notes: [] }));
t("caps overlong summary", long.summary.length <= 500, long.summary.length);

console.log("\nassessRisk bands");
t("no observations -> 0 / low", assessRisk([]).score === 0 && assessRisk([]).level === "low");
const giftOnly = assessRisk([{ code: "gift_card_payment", confidence: 0.9, evidence: "" }]);
t("a confident gift-card demand alone is High Risk", giftOnly.level === "high", giftOnly.score);
const hedged = assessRisk([{ code: "gift_card_payment", confidence: 0.4, evidence: "" }]);
t("a hedged gift-card observation does not trigger the floor", hedged.score < 61, hedged.score);
const mitigated = assessRisk([
  { code: "deposit_request", confidence: 0.6, evidence: "" },
  { code: "verified_platform_checkout", confidence: 0.9, evidence: "" },
]);
t("mitigating signals lower the score", mitigated.score <= 8, mitigated.score);
t("mitigating signals never go below 0", mitigated.score >= 0, mitigated.score);
const many = assessRisk(["deposit_request","urgency_pressure","off_platform","no_verifiable_identity","suspicious_wording"].map(code => ({ code, confidence: 0.6, evidence: "" })));
t("many independent moderate signals accumulate", many.score > 30, many.score);

// Repeated codes must merge into one stronger sign, not collapse to the first.
const repeated = assessRisk([
  { code: "suspicious_url", confidence: 0.4, evidence: "The link is not encrypted." },
  { code: "suspicious_url", confidence: 0.5, evidence: "The domain ends in a throwaway extension." },
  { code: "suspicious_url", confidence: 0.5, evidence: "The address stacks several subdomains." },
]);
t("repeated codes merge into a single warning sign", repeated.warningSigns.length === 1, repeated.warningSigns.length);
t("the merged sign keeps every piece of evidence", repeated.warningSigns[0].detail.split(".").filter(Boolean).length === 3, repeated.warningSigns[0].detail);
t("merging is stronger than the first observation alone",
  repeated.score > assessRisk([{ code: "suspicious_url", confidence: 0.4, evidence: "" }]).score,
  repeated.score);
const single = assessRisk([{ code: "suspicious_url", confidence: 0.5, evidence: "x" }]);
t("merged confidence never exceeds the signal weight", repeated.score <= 16, repeated.score);
t("a single observation is unchanged by the merge logic", single.warningSigns[0].detail === "x");
t("every band produces recommendations", [giftOnly, mitigated, many].every(r => r.recommendations.length >= 3));

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
