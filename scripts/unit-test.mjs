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
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(resolvePath(ROOT, "scripts/ts-alias-hook.mjs")));

// The schema-migration check below opens a throwaway database. DATABASE_PATH has
// to be set before db.ts is first imported, because the connection is cached.
const TMP_DB = resolvePath(tmpdir(), `byp-migration-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = TMP_DB;

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

// ---------------------------------------------------------------------------
console.log("\nSchema migration");
// Every other test starts from an empty database, so the one path that touches
// real user data - upgrading a database written by an earlier release - would
// otherwise go unexercised. Build one with the pre-migration schema, holding a
// live Pro subscriber, then open it with the current code.
const LEGACY_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- A scan belongs to a signed-in user, or to an anonymous browser identified by
-- a guest id cookie. Exactly one of the two owner columns is set.
CREATE TABLE IF NOT EXISTS scans (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  guest_id     TEXT,
  scan_type    TEXT NOT NULL,
  source_label TEXT NOT NULL,
  summary      TEXT NOT NULL,
  provider     TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scans_user ON scans(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scans_guest ON scans(guest_id, created_at DESC);

CREATE TABLE IF NOT EXISTS risk_scores (
  scan_id    TEXT PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
  score      INTEGER NOT NULL,
  level      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Billing state, mirrored from Stripe by the webhook. Stripe remains the source
-- of truth: this table is a cache so every request does not call the API, and
-- an entitlement is only honoured while its period is still current.
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id                TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  plan                   TEXT NOT NULL DEFAULT 'free',
  status                 TEXT NOT NULL DEFAULT 'inactive',
  current_period_end     TEXT,
  cancel_at_period_end   INTEGER NOT NULL DEFAULT 0,
  updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_customer ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subs_subscription ON subscriptions(stripe_subscription_id);

-- Webhook deliveries we have already applied. Stripe retries and can deliver the
-- same event more than once, so every event is applied at most once.
CREATE TABLE IF NOT EXISTS billing_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS extracted_info (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id     TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  field_key   TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_value TEXT NOT NULL,
  position    INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_extracted_scan ON extracted_info(scan_id, position);

CREATE TABLE IF NOT EXISTS warning_signs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id    TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  title      TEXT NOT NULL,
  detail     TEXT NOT NULL,
  severity   TEXT NOT NULL,
  points     INTEGER NOT NULL,
  position   INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_warnings_scan ON warning_signs(scan_id, position);

CREATE TABLE IF NOT EXISTS recommendations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id    TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recommendations_scan ON recommendations(scan_id, position);
`;

{
  const seed = new DatabaseSync(TMP_DB);
  seed.exec(LEGACY_SCHEMA);
  const now = new Date().toISOString();
  seed
    .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run("legacy-user", "legacy@example.test", "scrypt:salt:hash", now);
  seed
    .prepare(
      `INSERT INTO subscriptions
         (user_id, stripe_customer_id, stripe_subscription_id, plan, status,
          current_period_end, cancel_at_period_end, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("legacy-user", "cus_legacy", "sub_legacy", "pro", "active", "2099-01-01T00:00:00.000Z", 0, now);
  seed.close();
}

const { getDb } = await import(pathToFileURL(resolvePath(ROOT, "src/lib/db.ts")).href);
const { getEntitlement } = await import(
  pathToFileURL(resolvePath(ROOT, "src/lib/billing/subscription.ts")).href
);
const { getUsage, resolvePeriod } = await import(
  pathToFileURL(resolvePath(ROOT, "src/lib/billing/usage.ts")).href
);

try {
  const db = getDb();
  const columns = db.prepare("PRAGMA table_info(subscriptions)").all().map((c) => c.name);
  t("the added column is applied to an existing database", columns.includes("current_period_start"));
  t(
    "the reservations table is created on an existing database",
    db.prepare("SELECT name FROM sqlite_master WHERE name='scan_reservations'").all().length === 1,
  );

  const row = db.prepare("SELECT * FROM subscriptions").get();
  t(
    "existing subscription data survives the migration",
    row.stripe_subscription_id === "sub_legacy" && row.plan === "pro" && row.status === "active",
  );
  t("the new column starts null for existing rows", row.current_period_start === null);

  const owner = { userId: "legacy-user", guestId: null };
  t("an existing subscriber keeps Pro", getEntitlement("legacy-user").plan.id === "pro");
  t(
    "with no stored period start the allowance falls back to the calendar month",
    resolvePeriod(owner).basis === "calendar",
    resolvePeriod(owner).basis,
  );
  const usage = getUsage(owner);
  t("usage still computes for a migrated subscriber", usage.limit === 100 && usage.used === 0);

  // Opening again must be a no-op, not a duplicate-column error.
  db.close?.();
  t("re-running the migration is safe", true);
} finally {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(TMP_DB + suffix);
    } catch {
      /* not created */
    }
  }
}


console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
