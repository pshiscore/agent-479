import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Production uses Supabase's transaction pooler with a pool of 5 (src/lib/db/client.ts).
// On 2026-10-11, /new fired 6 queries at once and hung until the 300 s timeout.
// So app code never runs Promise.all over a list (an unbounded burst); loop instead.
const root = path.resolve(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });

describe("no unbounded query bursts", () => {
  it("no Promise.all over .map(...) in src", () => {
    const hits = files(path.join(root, "src")).filter((f) => /Promise\.all\(\s*[\w.]+\.map\(/.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => path.relative(root, f))).toEqual([]);
  });
});
