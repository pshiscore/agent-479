import { describe, expect, it } from "vitest";
import { LINK_POLICY_SEEDS, SOURCE_SEEDS } from "./seed-data";

const bySlug = new Map(SOURCE_SEEDS.map((s) => [s.slug, s]));

describe("source seeds", () => {
  it("has the 9 Phase 1 sources plus 3 Tier 1 sources, with unique slugs", () => {
    expect(SOURCE_SEEDS).toHaveLength(12);
    expect(bySlug.size).toBe(12);
    expect(SOURCE_SEEDS.filter((s) => s.launch).map((s) => s.slug).sort()).toEqual(
      ["city-bentonville", "city-fayetteville", "city-fayetteville-volunteer", "city-pea-ridge", "city-rogers", "city-siloam-springs", "library-fayetteville", "library-rogers", "ticketmaster"],
    );
  });

  it("Tier 1 (owner, 2026-10-16): Siloam Springs skips adult sports and meetings; Fayetteville volunteer is its own source", () => {
    expect(bySlug.get("city-siloam-springs")!.config).toMatchObject({ catIds: [14, 25, 27] });
    expect(bySlug.get("city-fayetteville-volunteer")!.config).toMatchObject({ catIds: [36] });
    expect(bySlug.get("city-fayetteville")!.config).toMatchObject({ catIds: [30, 33] });
    expect(bySlug.get("city-pea-ridge")!.config).toMatchObject({ feedUrl: "https://cityofpearidgear.gov/events/?ical=1" });
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

describe("library feeds", () => {
  it("records the Fayetteville iCal feed as owner-verified, 30 days, all filters", () => {
    const config = bySlug.get("library-fayetteville")!.config as {
      feedUrl: string;
      feedUrlSource: { verifiedBy: string };
    };
    const data = new URL(config.feedUrl).searchParams.get("data")!;
    expect(JSON.parse(Buffer.from(data, "base64").toString("utf8"))).toEqual({
      feedType: "ical",
      filters: { location: ["all"], ages: ["all"], types: ["all"], tags: [], term: "", days: 30 },
    });
    expect(config.feedUrlSource.verifiedBy).toBe("owner");
  });

  it("still has no Rogers feed URL", () => {
    expect(bySlug.get("library-rogers")!.config.feedUrl).toBeNull();
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
