import { describe, expect, it } from "vitest";
import { pickFeature } from "./feature";

const NOW = new Date("2026-10-05T15:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const c = (id: string, startDays: number, seenDaysAgo: number, venueSlug = "library", inRecurringSeries = false, categorySlug = "music") => ({
  id, startAt: day(startDays), firstSeenAt: day(-seenDaysAgo), venueSlug, categorySlug, inRecurringSeries,
});

describe("pickFeature", () => {
  it("prefers newly announced at a large venue, then newly announced, then the soonest", () => {
    const pick = pickFeature([c("lib", 1, 1), c("amp", 10, 2, "walmart-amp"), c("old-arena", 2, 30, "bud-walton-arena")], NOW);
    expect(pick).toMatchObject({ id: "amp", score: 3, rules: { newlyAnnounced: true, largeVenue: true } });
    expect(pickFeature([c("a", 5, 1), c("b", 2, 1)], NOW)?.id).toBe("b");
  });
  it("never features recurring series, past events, events beyond the horizon, or events meeting no rule", () => {
    expect(pickFeature([c("series", 1, 1, "walmart-amp", true)], NOW)).toBeNull();
    expect(pickFeature([c("past", -1, 1, "walmart-amp")], NOW)).toBeNull();
    expect(pickFeature([c("far", 60, 1, "walmart-amp")], NOW)).toBeNull();
    expect(pickFeature([c("stale", 3, 30)], NOW)).toBeNull();
  });

  it("gives Butterfield Stage the large-venue point, but never to a Sports event", () => {
    expect(pickFeature([c("stage", 5, 30, "butterfield-stage")], NOW)?.rules.largeVenue).toBe(true);
    expect(pickFeature([c("game", 5, 30, "bud-walton-arena", false, "sports")], NOW)).toBeNull();
    // A newly announced Sports event can still feature, on that rule alone.
    expect(pickFeature([c("game", 5, 2, "bud-walton-arena", false, "sports")], NOW)).toMatchObject({ rules: { newlyAnnounced: true, largeVenue: false }, score: 2 });
  });
});
