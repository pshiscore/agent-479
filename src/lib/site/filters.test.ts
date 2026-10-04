import { describe, expect, it } from "vitest";
import { filterQuery, parseFilters } from "./filters";

describe("parseFilters", () => {
  it("reads slugs, comma-separated tags, venue type, and the recurring toggle", () => {
    expect(parseFilters({ city: "bentonville", tags: "free,family-friendly", venue_type: "library", recurring: "1" })).toEqual({
      city: "bentonville", category: undefined, tags: ["free", "family-friendly"], venueType: "library", showRecurring: true,
    });
  });
  it("drops anything that isn't a slug", () => {
    expect(parseFilters({ city: "<script>", category: "music' or 1=1", tags: "free,../x", venue_type: "lib rary" })).toEqual({
      city: undefined, category: undefined, tags: ["free"], venueType: undefined, showRecurring: false,
    });
  });
  it("round-trips through the URL", () => {
    const f = parseFilters({ category: "music", tags: ["free", "ticketed"] });
    expect(filterQuery(f)).toBe("?category=music&tags=free%2Cticketed");
    expect(parseFilters(Object.fromEntries(new URLSearchParams(filterQuery(f).slice(1))))).toEqual(f);
  });
});
