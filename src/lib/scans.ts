import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import type {
  AnalysisExtraction,
  RiskResult,
  ScanRecord,
  ScanSummaryRecord,
  ScanType,
} from "./types";

export interface ScanOwner {
  userId: string | null;
  guestId: string | null;
}

interface SaveScanInput {
  owner: ScanOwner;
  scanType: ScanType;
  sourceLabel: string;
  provider: string;
  extraction: AnalysisExtraction;
  risk: RiskResult;
}

/** Persists a completed analysis. The screenshot itself is never stored. */
export function saveScan(input: SaveScanInput): string {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const { owner, extraction, risk } = input;

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO scans (id, user_id, guest_id, scan_type, source_label, summary, provider, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      owner.userId,
      owner.userId ? null : owner.guestId,
      input.scanType,
      input.sourceLabel.slice(0, 300),
      extraction.summary,
      input.provider,
      JSON.stringify(extraction.notes),
      now,
    );

    db.prepare(
      "INSERT INTO risk_scores (scan_id, score, level, created_at) VALUES (?, ?, ?, ?)",
    ).run(id, risk.score, risk.level, now);

    const field = db.prepare(
      `INSERT INTO extracted_info (scan_id, field_key, field_label, field_value, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    extraction.fields.forEach((f, i) => field.run(id, f.key, f.label, f.value, i, now));

    const warning = db.prepare(
      `INSERT INTO warning_signs (scan_id, code, title, detail, severity, points, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    risk.warningSigns.forEach((w, i) =>
      warning.run(id, w.code, w.title, w.detail, w.severity, w.points, i, now),
    );

    const rec = db.prepare(
      "INSERT INTO recommendations (scan_id, text, position, created_at) VALUES (?, ?, ?, ?)",
    );
    risk.recommendations.forEach((text, i) => rec.run(id, text, i, now));

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return id;
}

interface ScanRow {
  id: string;
  scan_type: string;
  source_label: string;
  summary: string;
  provider: string;
  notes: string;
  created_at: string;
  score: number;
  level: string;
  user_id: string | null;
  guest_id: string | null;
}

function parseNotes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Loads one scan, enforcing ownership in the query itself: a signed-in user can
 * only read their own rows, and an anonymous browser can only read rows tagged
 * with its own guest id. There is no code path that returns someone else's scan.
 */
export function getScanForOwner(id: string, owner: ScanOwner): ScanRecord | null {
  const db = getDb();

  const row = (
    owner.userId
      ? db
          .prepare(
            `SELECT s.*, r.score, r.level FROM scans s
               JOIN risk_scores r ON r.scan_id = s.id
              WHERE s.id = ? AND s.user_id = ?`,
          )
          .get(id, owner.userId)
      : owner.guestId
        ? db
            .prepare(
              `SELECT s.*, r.score, r.level FROM scans s
                 JOIN risk_scores r ON r.scan_id = s.id
                WHERE s.id = ? AND s.user_id IS NULL AND s.guest_id = ?`,
            )
            .get(id, owner.guestId)
        : undefined
  ) as ScanRow | undefined;

  if (!row) return null;

  const fields = db
    .prepare(
      "SELECT field_key, field_label, field_value FROM extracted_info WHERE scan_id = ? ORDER BY position",
    )
    .all(id) as Array<{ field_key: string; field_label: string; field_value: string }>;

  const warnings = db
    .prepare(
      "SELECT code, title, detail, severity, points FROM warning_signs WHERE scan_id = ? ORDER BY position",
    )
    .all(id) as Array<{
    code: string;
    title: string;
    detail: string;
    severity: string;
    points: number;
  }>;

  const recs = db
    .prepare("SELECT text FROM recommendations WHERE scan_id = ? ORDER BY position")
    .all(id) as Array<{ text: string }>;

  return {
    id: row.id,
    scanType: row.scan_type as ScanType,
    sourceLabel: row.source_label,
    summary: row.summary,
    score: row.score,
    level: row.level as ScanRecord["level"],
    provider: row.provider,
    createdAt: row.created_at,
    fields: fields.map((f) => ({ key: f.field_key, label: f.field_label, value: f.field_value })),
    warningSigns: warnings.map((w) => ({
      code: w.code,
      title: w.title,
      detail: w.detail,
      severity: w.severity as ScanRecord["level"],
      points: w.points,
    })),
    recommendations: recs.map((r) => r.text),
    notes: parseNotes(row.notes),
  };
}

/** History list. Scoped to the signed-in user; never returns other users' scans. */
export function listScansForUser(userId: string, limit = 50): ScanSummaryRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.scan_type, s.source_label, s.summary, s.created_at, r.score, r.level
         FROM scans s JOIN risk_scores r ON r.scan_id = s.id
        WHERE s.user_id = ?
        ORDER BY s.created_at DESC
        LIMIT ?`,
    )
    .all(userId, limit) as Array<{
    id: string;
    scan_type: string;
    source_label: string;
    summary: string;
    created_at: string;
    score: number;
    level: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    scanType: r.scan_type as ScanType,
    sourceLabel: r.source_label,
    summary: r.summary,
    score: r.score,
    level: r.level as ScanSummaryRecord["level"],
    createdAt: r.created_at,
  }));
}

/**
 * When a guest signs up or logs in, hand their recent anonymous scans to the
 * account so the history page is not empty for work they just did.
 */
export function claimGuestScans(guestId: string, userId: string): number {
  const result = getDb()
    .prepare("UPDATE scans SET user_id = ?, guest_id = NULL WHERE guest_id = ? AND user_id IS NULL")
    .run(userId, guestId);
  return Number(result.changes);
}
