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

function open(): DatabaseSync {
  const file = resolve(process.env.DATABASE_PATH ?? "./data/before-you-pay.db");
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

export function getDb(): DatabaseSync {
  if (!globalForDb.__bypDb) {
    globalForDb.__bypDb = open();
  }
  return globalForDb.__bypDb;
}
