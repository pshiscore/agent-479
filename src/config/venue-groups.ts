import type { VENUE_TYPES } from "@/lib/db/schema";

/**
 * Venue type groups for display (owner, 2026-10-17): our existing venue
 * types, grouped. Not a second category system: a venue's group follows from
 * its type alone. Every type is in exactly one group (a test checks), so every
 * active venue is too. "Other" holds venues still waiting for a real type
 * through the venue process.
 */

type VenueType = (typeof VENUE_TYPES)[number];

// Pin colors (map, Phase B): the Okabe-Ito colorblind-safe palette, with a white
// outline on every pin so each reads on both the light and the dark map.
export const VENUE_GROUPS = [
  { slug: "parks-trails", label: "Parks & Trails", types: ["park"], color: "#009E73" },
  { slug: "music-bars", label: "Music & Bars", types: ["music_venue", "bar"], color: "#CC79A7" },
  { slug: "museums-arts", label: "Museums & Arts", types: ["museum"], color: "#E69F00" },
  { slug: "arenas-theaters", label: "Arenas & Theaters", types: ["arena", "theater"], color: "#0072B2" },
  { slug: "libraries-civic", label: "Libraries & Civic", types: ["library", "campus"], color: "#56B4E9" },
  { slug: "event-spaces", label: "Event Spaces", types: ["event_space"], color: "#D55E00" },
  { slug: "districts-markets", label: "Districts & Markets", types: ["area", "plaza", "market"], color: "#9C8A00" },
  { slug: "other", label: "Other", types: ["other"], color: "#6B6B6B" },
] as const satisfies readonly { slug: string; label: string; types: readonly VenueType[]; color: string }[];

export type VenueGroup = (typeof VENUE_GROUPS)[number];
export type VenueGroupSlug = VenueGroup["slug"];

/** The one group a venue type belongs to. */
export function groupOf(type: string): VenueGroup | null {
  return VENUE_GROUPS.find((g) => (g.types as readonly string[]).includes(type)) ?? null;
}
