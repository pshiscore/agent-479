import { describe, expect, it } from "vitest";
import { parseBackupLog, recentBackup } from "./backups";

const SHA = "a".repeat(64);
const LOG = `| Taken (UTC) | File | Bytes | SHA-256 | Before | Note |
|---|---|---|---|---|---|
| 2026-10-04T22:36Z | backups/old.dump | 10 | ${"b".repeat(64)} | 0017 | 191 entries |
| 2026-10-05T12:00Z | backups/new.dump | 20 | ${SHA} | 0022 | 200 entries |
`;
const disk = (files: Record<string, string>) => ({ exists: (f: string) => f in files, sha256: (f: string) => files[f] });

describe("production backup guard", () => {
  it("parses the log", () => {
    expect(parseBackupLog(LOG).map((r) => [r.file, r.before, r.takenAt.toISOString()])).toEqual([
      ["backups/old.dump", "0017", "2026-10-04T22:36:00.000Z"],
      ["backups/new.dump", "0022", "2026-10-05T12:00:00.000Z"],
    ]);
  });

  it("accepts a fresh backup on disk with a matching checksum", () => {
    const r = recentBackup(parseBackupLog(LOG), new Date("2026-10-05T13:00:00Z"), disk({ "backups/new.dump": SHA }));
    expect(r).toMatchObject({ ok: true, row: { before: "0022" } });
  });

  it("refuses when the newest backup is too old, missing, or altered", () => {
    const rows = parseBackupLog(LOG);
    expect(recentBackup(rows, new Date("2026-10-05T14:30:00Z"), disk({ "backups/new.dump": SHA }))).toMatchObject({ ok: false, reason: expect.stringContaining("last 120 minutes") });
    expect(recentBackup(rows, new Date("2026-10-05T12:30:00Z"), disk({}))).toMatchObject({ ok: false, reason: expect.stringContaining("missing") });
    expect(recentBackup(rows, new Date("2026-10-05T12:30:00Z"), disk({ "backups/new.dump": "c".repeat(64) }))).toMatchObject({ ok: false, reason: expect.stringContaining("checksum") });
  });

  it("the real log parses and lists the three existing backups", async () => {
    const { readFileSync } = await import("node:fs");
    expect(parseBackupLog(readFileSync("docs/BACKUPS.md", "utf8")).map((r) => r.before)).toEqual(["0017", "0020", "0021"]);
  });
});
