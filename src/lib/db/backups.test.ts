import { describe, expect, it } from "vitest";
import { newestMigration, parseBackupLog, recentBackup } from "./backups";

const SHA = "a".repeat(64);
const LOG = `| Taken (UTC) | File | Bytes | SHA-256 | Before | Note |
|---|---|---|---|---|---|
| 2026-10-04T22:36Z | backups/old.dump | 10 | ${"b".repeat(64)} | 0017 | 191 entries |
| 2026-10-05T12:00Z | backups/new.dump | 20 | ${SHA} | 0022 | 200 entries; off-site: r2:b/prod/new.dump.age sha256 ${"d".repeat(64)} |
| 2026-10-05T12:30Z | backups/local.dump | 20 | ${SHA} | 0023 | 200 entries |
`;
const disk = (files: Record<string, string>) => ({ exists: (f: string) => f in files, sha256: (f: string) => files[f] });

describe("production backup guard", () => {
  it("parses the log", () => {
    expect(parseBackupLog(LOG).map((r) => [r.file, r.before, r.takenAt.toISOString()])).toEqual([
      ["backups/old.dump", "0017", "2026-10-04T22:36:00.000Z"],
      ["backups/new.dump", "0022", "2026-10-05T12:00:00.000Z"],
      ["backups/local.dump", "0023", "2026-10-05T12:30:00.000Z"],
    ]);
    expect(parseBackupLog(LOG).map((r) => r.offsite)).toEqual([null, "r2:b/prod/new.dump.age", null]);
  });

  it("accepts a fresh backup on disk with a matching checksum and a verified off-site copy", () => {
    const r = recentBackup(parseBackupLog(LOG).slice(0, 2), new Date("2026-10-05T13:00:00Z"), disk({ "backups/new.dump": SHA }));
    expect(r).toMatchObject({ ok: true, row: { before: "0022" } });
  });

  it("refuses a backup without an off-site copy", () => {
    expect(recentBackup(parseBackupLog(LOG), new Date("2026-10-05T13:00:00Z"), disk({ "backups/local.dump": SHA }))).toMatchObject({ ok: false, reason: expect.stringContaining("off-site") });
  });

  it("refuses when the newest backup is too old, missing, or altered", () => {
    const rows = parseBackupLog(LOG).slice(0, 2);
    expect(recentBackup(rows, new Date("2026-10-05T14:30:00Z"), disk({ "backups/new.dump": SHA }))).toMatchObject({ ok: false, reason: expect.stringContaining("last 120 minutes") });
    expect(recentBackup(rows, new Date("2026-10-05T12:30:00Z"), disk({}))).toMatchObject({ ok: false, reason: expect.stringContaining("missing") });
    expect(recentBackup(rows, new Date("2026-10-05T12:30:00Z"), disk({ "backups/new.dump": "c".repeat(64) }))).toMatchObject({ ok: false, reason: expect.stringContaining("checksum") });
  });

  it("the real log parses and lists the existing backups", async () => {
    const { readFileSync } = await import("node:fs");
    const rows = parseBackupLog(readFileSync("docs/BACKUPS.md", "utf8"));
    expect(rows.slice(0, 4).map((r) => r.before)).toEqual(["0017", "0020", "0021", "0022"]);
    // From the off-site rule on (2026-10-11), every logged backup has a verified R2 copy.
    expect(rows.filter((r) => r.takenAt >= new Date("2026-10-11T00:00:00Z")).every((r) => r.offsite?.startsWith("r2:"))).toBe(true);
  });

  it("needs a backup made for the migration about to run, not an earlier one", () => {
    const rows = parseBackupLog(LOG).slice(0, 2); // newest: 0022, at 12:00
    const on = new Date("2026-10-05T12:30:00Z");
    expect(recentBackup(rows, on, disk({ "backups/new.dump": SHA }), "0022")).toMatchObject({ ok: true });
    expect(recentBackup(rows, on, disk({ "backups/new.dump": SHA }), "0023")).toMatchObject({ ok: false, reason: expect.stringContaining("no backup for 0023") });
  });

  it("knows the newest migration from the journal", () => {
    expect(newestMigration()).toMatch(/^\d{4}$/);
  });
});
