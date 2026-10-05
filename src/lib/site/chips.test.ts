import { describe, expect, it } from "vitest";
import { activeCount, clearAll, toggleRecurring, toggleTag, withCategory, withCity, withVenueType } from "./chips";
import { parseFilters } from "./filters";

const f = parseFilters({ city: "rogers", tags: "free" });
const keep = { from: "2026-10-09", days: "3" };

describe("chip URLs", () => {
  it("dropdown chips set or clear one filter and keep the rest and the date range", () => {
    expect(withCity("/upcoming", f, "bentonville", keep)).toBe("/upcoming?city=bentonville&tags=free&from=2026-10-09&days=3");
    expect(withCity("/upcoming", f, undefined)).toBe("/upcoming?tags=free");
    expect(withCategory("/upcoming", f, "music")).toBe("/upcoming?city=rogers&category=music&tags=free");
    expect(withVenueType("/upcoming", f, "library")).toBe("/upcoming?city=rogers&tags=free&venue_type=library");
  });
  it("toggle chips add or remove their tag", () => {
    expect(toggleTag("/upcoming", f, "21-plus")).toBe("/upcoming?city=rogers&tags=free%2C21-plus");
    expect(toggleTag("/upcoming", f, "free")).toBe("/upcoming?city=rogers");
  });
  it("the recurring switch flips, and Clear all removes every filter but keeps the dates", () => {
    expect(toggleRecurring("/upcoming", f)).toBe("/upcoming?city=rogers&tags=free&recurring=1");
    expect(toggleRecurring("/upcoming", { ...f, showRecurring: true })).toBe("/upcoming?city=rogers&tags=free");
    expect(clearAll("/upcoming", keep)).toBe("/upcoming?from=2026-10-09&days=3");
    expect(clearAll("/city/rogers")).toBe("/city/rogers");
  });
  it("counts active filters", () => {
    expect(activeCount(f)).toBe(2);
    expect(activeCount(parseFilters({}))).toBe(0);
  });
});
