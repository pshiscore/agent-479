import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/**
 * Production backups before migrations (AGENTS.md rule 11). Each backup is a
 * pg_dump file in the gitignored `backups/` folder, logged as one row in
 * docs/BACKUPS.md (committed). A production migration refuses to run unless
 * a logged backup from the last BACKUP_MAX_AGE_MINUTES exists on disk with a
 * matching checksum.
 */

export const BACKUP_LOG = "docs/BACKUPS.md";
export const BACKUP_MAX_AGE_MINUTES = 120;

export interface BackupRow {
  takenAt: Date;
  file: string;
  bytes: number;
  sha256: string;
  before: string;
}

/** Log rows look like: | 2026-10-04T22:36Z | backups/x.dump | 1284176 | <sha256> | 0017 | note | */
export function parseBackupLog(text: string): BackupRow[] {
  const rows: BackupRow[] = [];
  for (const line of text.split("\n")) {
    const m = /^\|\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z)\s*\|\s*(backups\/\S+)\s*\|\s*(\d+)\s*\|\s*([0-9a-f]{64})\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (m) rows.push({ takenAt: new Date(m[1].replace("Z", ":00Z")), file: m[2], bytes: Number(m[3]), sha256: m[4], before: m[5] });
  }
  return rows;
}

export const sha256File = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** The newest logged backup young enough to cover a migration now, whose file still matches; else the reason there isn't one. */
export function recentBackup(
  rows: readonly BackupRow[],
  now: Date,
  check: { exists: (file: string) => boolean; sha256: (file: string) => string } = { exists: existsSync, sha256: sha256File },
): { ok: true; row: BackupRow } | { ok: false; reason: string } {
  const fresh = rows.filter((r) => now.getTime() - r.takenAt.getTime() <= BACKUP_MAX_AGE_MINUTES * 60_000 && r.takenAt <= now);
  if (fresh.length === 0) return { ok: false, reason: `no backup logged in ${BACKUP_LOG} in the last ${BACKUP_MAX_AGE_MINUTES} minutes; run npm run db:backup:prod -- --before <migration>` };
  const row = fresh.sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())[0];
  if (!check.exists(row.file)) return { ok: false, reason: `${row.file} is logged but missing on disk` };
  if (check.sha256(row.file) !== row.sha256) return { ok: false, reason: `${row.file} doesn't match its logged checksum` };
  return { ok: true, row };
}

/** Called by drizzle.config.ts before any production migration. */
export function assertRecentBackup(now = new Date()): BackupRow {
  const text = existsSync(BACKUP_LOG) ? readFileSync(BACKUP_LOG, "utf8") : "";
  const r = recentBackup(parseBackupLog(text), now);
  if (!r.ok) throw new Error(`Refusing to migrate production: ${r.reason}`);
  return r.row;
}
