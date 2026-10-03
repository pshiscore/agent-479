import { describe, expect, it } from "vitest";
import { LINK_POLICY_SEEDS, SOURCE_SEEDS } from "./seed-data";

const bySlug = new Map(SOURCE_SEEDS.map((s) => [s.slug, s]));

describe("source seeds", () => {
  it("has the 9 Phase 1 sources with unique slugs, 6 marked for launch", () => {
    expect(SOURCE_SEEDS).toHaveLength(9);
    expect(bySlug.size).toBe(9);
    expect(SOURCE_SEEDS.filter((s) => s.launch).map((s) => s.slug).sort()).toEqual(
      ["city-bentonville", "city-fayetteville", "city-rogers", "library-fayetteville", "library-rogers", "ticketmaster"],
    );
  });

  // docs/sources-terms.md summary table: change both together.
  it("keeps the three awaiting-permission sources off, with no fetcher", () => {
    for (const slug of ["walton-arts-center", "crystal-bridges", "the-momentary"]) {
      const s = bySlug.get(slug)!;
      expect(s.launch).toBe(false);
      expect(s.fetcher).toBeNull();
      expect(s.termsNotes).toMatch(/^Awaiting permission\./);
    }
  });

  it("matches the terms review on commercial use", () => {
    const no = SOURCE_SEEDS.filter((s) => s.commercialUseOk === "no").map((s) => s.slug).sort();
    expect(no).toEqual(["crystal-bridges", "the-momentary", "ticketmaster"]);
    expect(SOURCE_SEEDS.some((s) => s.commercialUseOk === "yes")).toBe(false);
  });

  it("never uses public-meeting categories for the city feeds", () => {
    expect(bySlug.get("city-bentonville")!.config.catIds).toEqual([32]);
    expect(bySlug.get("city-rogers")!.config.catIds).toEqual([28]);
    expect(bySlug.get("city-fayetteville")!.config.catIds).toEqual([30, 33]);
  });

  it("uses https base URLs and sane trust and intervals", () => {
    for (const s of SOURCE_SEEDS) {
      expect(s.baseUrl).toMatch(/^https:\/\//);
      expect(s.trustLevel).toBeGreaterThanOrEqual(1);
      expect(s.trustLevel).toBeLessThanOrEqual(5);
      expect(s.fetchIntervalMinutes).toBeGreaterThanOrEqual(15);
    }
  });
});

describe("link policy seeds", () => {
  it("limits Crystal Bridges and the Momentary to their homepages", () => {
    expect(LINK_POLICY_SEEDS.map((p) => [p.domain, p.mode, p.homepageUrl])).toEqual([
      ["crystalbridges.org", "homepage_only", "https://crystalbridges.org/"],
      ["themomentary.org", "homepage_only", "https://themomentary.org/"],
    ]);
  });
});
