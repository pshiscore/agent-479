import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isReservedRootSegment, RESERVED_ROOT_SEGMENTS } from "@/lib/routes";
import { slugify } from "@/lib/slug";
import { SOURCE_SEEDS } from "@/lib/sources/seed-data";
import { CATEGORY_SEEDS, TAG_SEEDS } from "@/lib/taxonomy/seed-data";

/**
 * Nothing data-named sits at the root (docs/product/front-page.md, section F).
 * Every root route the app has must be reserved, and no seeded slug (venues,
 * cities, categories, tags, sources) may equal a reserved segment, so a slug
 * can never shadow a system path even if an entity were ever served at the root.
 */

const APP = path.resolve(import.meta.dirname, "../src/app");
// Files in src/app that aren't routes.
const NOT_ROUTES = new Set(["layout.tsx", "page.tsx", "globals.css", "not-found.tsx", "error.tsx", "loading.tsx", "global-error.tsx"]);

// Route groups "(x)" add no URL segment: their children are root routes too.
const topLevel = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => (/^\(.*\)$/.test(n) ? topLevel(path.join(dir, n)) : [n]));

const rootRoutes = topLevel(APP)
  .filter((n) => !NOT_ROUTES.has(n))
  // A route file ("route.ts", "page.tsx") names its folder; image and text files are served under their own name.
  .map((n) => n.replace(/\.tsx?$/, ""))
  // Private folders "_x" don't create URL segments.
  .filter((n) => !n.startsWith("_"));

const seeds = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../data/venues.seed.json"), "utf8")) as {
  venues: { slug: string; city: string }[];
};

describe("URL namespaces", () => {
  it("reserves every root route the app has", () => {
    expect(rootRoutes.length).toBeGreaterThan(0);
    for (const r of rootRoutes) expect(isReservedRootSegment(r), `src/app/${r} is a root route; add it to RESERVED_ROOT_SEGMENTS`).toBe(true);
  });

  it("reserves the system paths and entity namespaces", () => {
    for (const p of ["admin", "bot", "robots.txt", "api", "events", "city", "venue", "category", "_next"]) expect(isReservedRootSegment(p)).toBe(true);
    expect(isReservedRootSegment("Admin")).toBe(true);
    expect(isReservedRootSegment("bentonville")).toBe(false);
  });

  it("no seeded slug collides with a reserved segment", () => {
    const slugs = [
      ...seeds.venues.map((v) => ["venue", v.slug]),
      ...[...new Set(seeds.venues.map((v) => v.city))].map((c) => ["city", slugify(c)]),
      ...CATEGORY_SEEDS.map((c) => ["category", c.slug]),
      ...TAG_SEEDS.map((t) => ["tag", t.slug]),
      ...SOURCE_SEEDS.map((s) => ["source", s.slug]),
    ];
    const clashes = slugs.filter(([, s]) => isReservedRootSegment(s));
    expect(clashes, `seeded slugs equal to reserved segments: ${JSON.stringify(clashes)}`).toEqual([]);
    expect(RESERVED_ROOT_SEGMENTS.length).toBeGreaterThan(10);
  });
});
