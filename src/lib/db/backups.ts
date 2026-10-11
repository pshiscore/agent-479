import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/**
 * Production backups before migrations (AGENTS.md rule 11). Each backup is a
 * pg_dump file in the gitignored `backups/` folder, logged as one row in
 * docs/BACKUPS.md (committed). A production migration refuses to run unless
 * a logged backup from the last BACKUP_MAX_AGE_MINUTES exists on disk with a
 * matching checksum, and has a verified off-site copy (src/lib/db/offsite.ts;
 * the row's note says "off-site: r2:<bucket>/<key> sha256 <hex>").
 */

export const BACKUP_LOG = "docs/BACKUPS.md";
export const BACKUP_MAX_AGE_MINUTES = 120;
export const PRUNE_LOG = "docs/BACKUPS-PRUNED.md";

export interface BackupRow {
  takenAt: Date;
  file: string;
  bytes: number;
  sha256: string;
  before: string;
  /** "r2:<bucket>/<key>" once the encrypted copy was uploaded and read back. */
  offsite: string | null;
}

/** Log rows look like: | 2026-10-04T22:36Z | backups/x.dump | 1284176 | <sha256> | 0017 | note | */
export function parseBackupLog(text: string): BackupRow[] {
  const rows: BackupRow[] = [];
  for (const line of text.split("\n")) {
    const m = /^\|\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z)\s*\|\s*(backups\/\S+)\s*\|\s*(\d+)\s*\|\s*([0-9a-f]{64})\s*\|\s*([^|]+?)\s*\|([^|]*)\|/.exec(line);
    const offsite = m ? (/off-site: (r2:\S+) sha256 [0-9a-f]{64}/.exec(m[6])?.[1] ?? null) : null;
    if (m) rows.push({ takenAt: new Date(m[1].replace("Z", ":00Z")), file: m[2], bytes: Number(m[3]), sha256: m[4], before: m[5], offsite });
  }
  return rows;
}

export const sha256File = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** The newest migration number in drizzle/meta/_journal.json ("0025"): the one a production migrate would end on. */
export function newestMigration(journalPath = "drizzle/meta/_journal.json"): string {
  const { entries } = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  return entries[entries.length - 1].tag.slice(0, 4);
}

/**
 * The newest logged backup young enough to cover a migration now, made for
 * that migration (its "before" names it), whose file still matches; else the
 * reason there isn't one. A backup made for an earlier migration doesn't count
 * (2026-10-11: 0025 ran on the 0024 backup after the 0025 backup failed).
 */
export function recentBackup(
  rows: readonly BackupRow[],
  now: Date,
  check: { exists: (file: string) => boolean; sha256: (file: string) => string } = { exists: existsSync, sha256: sha256File },
  forMigration?: string,
): { ok: true; row: BackupRow } | { ok: false; reason: string } {
  const fresh = rows.filter(
    (r) => now.getTime() - r.takenAt.getTime() <= BACKUP_MAX_AGE_MINUTES * 60_000 && r.takenAt <= now && (!forMigration || r.before === forMigration),
  );
  if (fresh.length === 0)
    return {
      ok: false,
      reason: `no backup ${forMigration ? `for ${forMigration} ` : ""}logged in ${BACKUP_LOG} in the last ${BACKUP_MAX_AGE_MINUTES} minutes; run npm run db:backup:prod -- --before ${forMigration ?? "<migration>"}`,
    };
  const row = fresh.sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())[0];
  if (!row.offsite) return { ok: false, reason: `${row.file} has no verified off-site copy; rerun npm run db:backup:prod` };
  if (!check.exists(row.file)) return { ok: false, reason: `${row.file} is logged but missing on disk` };
  if (check.sha256(row.file) !== row.sha256) return { ok: false, reason: `${row.file} doesn't match its logged checksum` };
  return { ok: true, row };
}

/** Called by drizzle.config.ts before any production migration. */
export function assertRecentBackup(now = new Date(), forMigration = newestMigration()): BackupRow {
  const text = existsSync(BACKUP_LOG) ? readFileSync(BACKUP_LOG, "utf8") : "";
  const r = recentBackup(parseBackupLog(text), now, undefined, forMigration);
  if (!r.ok) throw new Error(`Refusing to migrate production: ${r.reason}`);
  return r.row;
}
