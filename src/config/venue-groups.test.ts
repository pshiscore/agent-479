import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VENUE_TYPES } from "@/lib/db/schema";
import { groupOf, VENUE_GROUPS } from "./venue-groups";

const groupsFor = (type: string) => VENUE_GROUPS.filter((g) => (g.types as readonly string[]).includes(type));

describe("venue groups", () => {
  it("put every venue type in exactly one group", () => {
    for (const t of VENUE_TYPES) expect(groupsFor(t).map((g) => g.slug), t).toHaveLength(1);
    expect(VENUE_GROUPS.flatMap((g) => g.types).sort()).toEqual([...VENUE_TYPES].sort());
  });

  it("put every active venue in the seed in exactly one group", () => {
    const seed = JSON.parse(readFileSync("data/venues.seed.json", "utf8")) as { venues: { slug: string; venueType: string; active?: boolean }[] };
    const active = seed.venues.filter((v) => v.active !== false);
    expect(active.length).toBeGreaterThan(50);
    for (const v of active) expect(groupsFor(v.venueType), v.slug).toHaveLength(1);
    expect(groupOf("theater")?.label).toBe("Arenas & Theaters");
    expect(groupOf("nonsense")).toBeNull();
  });
});
