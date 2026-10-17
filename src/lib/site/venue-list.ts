import { sql } from "drizzle-orm";
import { groupOf, type VenueGroup } from "@/config/venue-groups";
import type { DbExecutor } from "@/lib/db/client";
import { slugify } from "@/lib/slug";
import { foldRecurring, listEvents, publicVenue } from "./queries";

/**
 * The /venues list (owner, 2026-10-17). Counts come from the same listEvents
 * and foldRecurring as the Upcoming page, so a recurring series counts once,
 * hidden events and inactive or out-of-area venues never count (and shadow
 * items aren't events), and Ticketmaster events count exactly when Upcoming
 * shows them (sourceVisible).
 */

export const COUNT_DAYS = 30;

export interface VenueListItem {
  slug: string;
  name: string;
  city: { slug: string; name: string };
  type: string;
  group: VenueGroup;
  upcoming: number;
  // Our signed-off venue coordinates (never re-geocoded, never Google's).
  lat: number;
  lng: number;
}

export async function venueList(db: DbExecutor, now: Date): Promise<VenueListItem[]> {
  const rows = (await db.execute(sql`
    select v.slug, v.name, v.city, v.venue_type, v.lat::float lat, v.lng::float lng from venues v where ${publicVenue("v")} order by v.name`)) as unknown as { slug: string; name: string; city: string; venue_type: string; lat: number; lng: number }[];
  const items = await listEvents(db, { from: now, to: new Date(now.getTime() + COUNT_DAYS * 86_400_000) });
  const { events, series } = foldRecurring(items, false);
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.venue.slug, (counts.get(e.venue.slug) ?? 0) + 1);
  for (const s of series) counts.set(s.venue.slug, (counts.get(s.venue.slug) ?? 0) + 1);
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    city: { slug: slugify(r.city), name: r.city },
    type: r.venue_type,
    // Every type has a group (src/config/venue-groups.test.ts); "Other" is the last resort.
    group: groupOf(r.venue_type) ?? groupOf("other")!,
    upcoming: counts.get(r.slug) ?? 0,
    lat: r.lat,
    lng: r.lng,
  }));
}

export type VenueSort = "az" | "upcoming";
export interface VenueFilters {
  city?: string;
  type?: string;
  upcoming?: boolean;
  sort?: VenueSort;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The URL is the state: ?city=&type=&upcoming=1&sort=upcoming. Unknown values are ignored. */
export function parseVenueFilters(q: Record<string, string | string[] | undefined>): VenueFilters {
  const sort = one(q.sort) === "upcoming" ? "upcoming" : undefined;
  return { city: one(q.city) || undefined, type: one(q.type) || undefined, upcoming: one(q.upcoming) === "1" || undefined, sort };
}

export function venueHref(f: VenueFilters, change: Partial<Record<keyof VenueFilters, VenueFilters[keyof VenueFilters] | undefined>> = {}): string {
  const next = { ...f, ...change };
  const p = new URLSearchParams();
  if (next.city) p.set("city", String(next.city));
  if (next.type) p.set("type", String(next.type));
  if (next.upcoming) p.set("upcoming", "1");
  if (next.sort === "upcoming") p.set("sort", "upcoming");
  const s = p.toString();
  return s ? `/venues?${s}` : "/venues";
}

/** Pure: applies the filters and the sort (A–Z by default, or most upcoming, then A–Z). */
export function filterVenues(items: readonly VenueListItem[], f: VenueFilters): VenueListItem[] {
  const out = items.filter((v) => (!f.city || v.city.slug === f.city) && (!f.type || v.group.slug === f.type) && (!f.upcoming || v.upcoming > 0));
  return out.sort((a, b) => (f.sort === "upcoming" ? b.upcoming - a.upcoming : 0) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}
