import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isOutdoorVenue } from "./outdoor";

// The list the owner approved (2026-10-17). Bud Walton Arena and Barnhill Arena are indoor.
const APPROVED = [
  "upper-ramble", "gulley-park", "wilson-park", "kessler-mountain-regional-park", "lake-fayetteville-park", "botanical-garden-of-the-ozarks",
  "railyard-bike-park", "lake-atalanta-park", "compton-gardens", "orchards-park", "slaughter-pen-trail", "luther-george-park",
  "pea-ridge-national-military-park", "prairie-grove-battlefield-state-park",
  "fayetteville-downtown-square", "dickson-street", "the-ramble", "downtown-rogers", "bentonville-square", "lawrence-plaza",
  "walmart-amp", "butterfield-stage", "arvest-ballpark", "baum-walker-stadium", "razorback-stadium", "razorback-field",
  // Added by the owner, 2026-10-17: an open-air shopping center.
  "pinnacle-hills-promenade",
];

describe("outdoor venues", () => {
  it("are exactly the 27 the owner approved", () => {
    const seed = JSON.parse(readFileSync("data/venues.seed.json", "utf8")) as { venues: { slug: string; venueType: string; outdoor?: boolean; active?: boolean }[] };
    const outdoor = seed.venues.filter((v) => v.active !== false && isOutdoorVenue(v)).map((v) => v.slug);
    expect(outdoor.sort()).toEqual([...APPROVED].sort());
    expect(outdoor).not.toContain("bud-walton-arena");
    expect(outdoor).not.toContain("barnhill-arena");
  });
});
