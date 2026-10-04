import { describe, expect, it } from "vitest";
import { CATEGORY_SEEDS, COMMUNITY_SLUG, TAG_SEEDS } from "./seed-data";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe("category seeds", () => {
  it("are the 12 plan categories, in plan order", () => {
    expect(CATEGORY_SEEDS.map((c) => c.name)).toEqual([
      "Music",
      "Arts & Theater",
      "Comedy",
      "Film",
      "Family & Kids",
      "Food & Drink",
      "Outdoors & Fitness",
      "Sports",
      "Festivals & Markets",
      "Talks & Learning",
      "Community",
      "Nightlife",
    ]);
  });

  it("have unique valid slugs and strictly increasing sort", () => {
    const slugs = CATEGORY_SEEDS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(SLUG);
    const sorts = CATEGORY_SEEDS.map((c) => c.sort);
    expect(sorts).toEqual([...sorts].sort((a, b) => a - b));
    expect(new Set(sorts).size).toBe(sorts.length);
  });

  it("include Community, which the classifier's missing-category hint depends on", () => {
    expect(CATEGORY_SEEDS.some((c) => c.slug === COMMUNITY_SLUG)).toBe(true);
  });
});

describe("tag seeds", () => {
  it("are the 6 plan tags plus the owner-added ones, with unique valid slugs and names", () => {
    expect(TAG_SEEDS.map((t) => t.name)).toEqual(["Free", "Outdoor", "Family-friendly", "21+", "Dog-friendly", "Biking", "Volunteer", "Registration required", "Ticketed", "En español"]);
    for (const t of TAG_SEEDS) expect(t.slug).toMatch(SLUG);
    expect(new Set(TAG_SEEDS.map((t) => t.slug)).size).toBe(TAG_SEEDS.length);
    expect(new Set(TAG_SEEDS.map((t) => t.name.toLowerCase())).size).toBe(TAG_SEEDS.length);
  });
});
