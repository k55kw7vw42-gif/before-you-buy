import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * SQLite via Node's built-in driver - no native module to compile, no server to
 * run. The connection is cached on globalThis so Next.js dev hot-reloads reuse
 * one handle instead of leaking a new one per module evaluation.
 */

const globalForDb = globalThis as unknown as { __bypDb?: DatabaseSync };

const SCHEMA = `
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

-- A slot claimed against a plan allowance for the duration of one analysis.
-- The row is written before the vision model is called and removed once the
-- scan is saved (or the attempt fails), so two concurrent requests cannot both
-- pass a check that only one of them has room for.
CREATE TABLE IF NOT EXISTS scan_reservations (
  id           TEXT PRIMARY KEY,
  owner_key    TEXT NOT NULL,
  period_start TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reservations_owner
  ON scan_reservations(owner_key, period_start, expires_at);

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

/**
 * Columns added after a table first shipped. SQLite has no "ADD COLUMN IF NOT
 * EXISTS", so each one is checked against the live table before it is added.
 */
const ADDED_COLUMNS: Array<{ table: string; column: string; ddl: string }> = [
  {
    table: "subscriptions",
    column: "current_period_start",
    ddl: "ALTER TABLE subscriptions ADD COLUMN current_period_start TEXT",
  },
  {
    // Set for accounts created through Google. Null for password accounts.
    table: "users",
    column: "google_id",
    ddl: "ALTER TABLE users ADD COLUMN google_id TEXT",
  },
];

/** Indexes over migrated columns, which can only be created once they exist. */
const POST_MIGRATION_DDL = [
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_id) WHERE google_id IS NOT NULL",
];

function migrate(db: DatabaseSync): void {
  for (const { table, column, ddl } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === column)) db.exec(ddl);
  }
  for (const ddl of POST_MIGRATION_DDL) db.exec(ddl);
}

function open(): DatabaseSync {
  const file = resolve(process.env.DATABASE_PATH ?? "./data/before-you-pay.db");
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export function getDb(): DatabaseSync {
  if (!globalForDb.__bypDb) {
    globalForDb.__bypDb = open();
  }
  return globalForDb.__bypDb;
}
