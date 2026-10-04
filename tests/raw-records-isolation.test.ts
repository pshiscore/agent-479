import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AGENTS.md rule 4: raw_records (and the source descriptions in it) is
 * internal staging. No public page, API route, feed, or digest may read it.
 *
 * This walks the import graph from every public entry point and fails if any
 * reachable module touches raw_records. Internal entry points are the cron
 * routes and the admin pages, both behind auth. The schema files are skipped:
 * defining the table isn't reading it.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");
const READS_RAW = /\brawRecords\b|\braw_records\b|\bdescriptionText\b|\bdescription_text\b/;
const INTERNAL = [path.join(SRC, "app/api/cron"), path.join(SRC, "app/admin")];
// Digest code publishes, so it counts as public even though it lives in lib.
const EXTRA_PUBLIC = [path.join(SRC, "lib/pipeline/digest")];
const SCHEMA = path.join(SRC, "lib/db/schema");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // a package
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

/** Every module reachable from `entries`, mapped to the import chain that reached it. */
function reachable(entries: string[]): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue: [string, string[]][] = entries.map((e) => [e, [e]]);
  while (queue.length) {
    const [file, chain] = queue.shift()!;
    if (seen.has(file)) continue;
    seen.set(file, chain);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(IMPORT_RE)) {
      const target = resolveImport(file, m[1] ?? m[2] ?? m[3]);
      if (target && !seen.has(target)) queue.push([target, [...chain, target]]);
    }
  }
  return seen;
}

function rawReaders(entries: string[]): string[] {
  const rel = (p: string) => path.relative(ROOT, p);
  return [...reachable(entries)]
    .filter(([file]) => !file.startsWith(SCHEMA) && READS_RAW.test(readFileSync(file, "utf8")))
    .map(([, chain]) => chain.map(rel).join(" → "));
}

const publicEntries = [
  ...walk(path.join(SRC, "app")).filter((f) => !INTERNAL.some((dir) => f.startsWith(dir))),
  ...EXTRA_PUBLIC.flatMap(walk),
];

describe("raw_records isolation", () => {
  it("has public entry points to check", () => {
    expect(publicEntries.length).toBeGreaterThan(0);
  });

  it("no public page, API route, feed, or digest can reach raw_records", () => {
    expect(rawReaders(publicEntries)).toEqual([]);
  });

  it("catches a reader when there is one (self-check, using the fetch cron route)", () => {
    const cron = path.join(SRC, "app/api/cron/fetch/route.ts");
    expect(rawReaders([cron]).some((chain) => chain.includes("src/lib/pipeline/fetch.ts"))).toBe(true);
  });
});
