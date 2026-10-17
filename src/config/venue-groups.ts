import type { VENUE_TYPES } from "@/lib/db/schema";

/**
 * Venue type groups for display (owner, 2026-10-17): our existing venue
 * types, grouped. Not a second category system: a venue's group follows from
 * its type alone. Every type is in exactly one group (a test checks), so every
 * active venue is too. "Other" holds venues still waiting for a real type
 * through the venue process.
 */

type VenueType = (typeof VENUE_TYPES)[number];

export const VENUE_GROUPS = [
  { slug: "parks-trails", label: "Parks & Trails", types: ["park"] },
  { slug: "music-bars", label: "Music & Bars", types: ["music_venue", "bar"] },
  { slug: "museums-arts", label: "Museums & Arts", types: ["museum"] },
  { slug: "arenas-theaters", label: "Arenas & Theaters", types: ["arena", "theater"] },
  { slug: "libraries-civic", label: "Libraries & Civic", types: ["library", "campus"] },
  { slug: "event-spaces", label: "Event Spaces", types: ["event_space"] },
  { slug: "districts-markets", label: "Districts & Markets", types: ["area", "plaza", "market"] },
  { slug: "other", label: "Other", types: ["other"] },
] as const satisfies readonly { slug: string; label: string; types: readonly VenueType[] }[];

export type VenueGroup = (typeof VENUE_GROUPS)[number];
export type VenueGroupSlug = VenueGroup["slug"];

/** The one group a venue type belongs to. */
export function groupOf(type: string): VenueGroup | null {
  return VENUE_GROUPS.find((g) => (g.types as readonly string[]).includes(type)) ?? null;
}
