import { and, eq, isNotNull } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { rawRecords, sources, venueExternalIds, venues } from "@/lib/db/schema";
import { normalizeVenueName, venueNameKeys } from "@/lib/venues/normalize";
import { distanceMeters, NWA_BOUNDS } from "@/lib/venues/verify";

/**
 * Ticketmaster venue coverage: which Ticketmaster venues our fetched events
 * use, and whether each maps to one of our venues. A match is only ever a
 * proposal; links (venue_external_ids) are written after the owner approves.
 */

export interface TmVenue {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  events: number;
}

export interface OurVenue {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  address: string | null;
  city: string;
  lat: number;
  lng: number;
}

export type MatchKind = "linked" | "name" | "address" | "name_far" | "nearby" | "none" | "outside_nwa";

export interface VenueMatch {
  tm: TmVenue;
  kind: MatchKind;
  venue: OurVenue | null;
  distanceM: number | null;
  // True when Ticketmaster's point is a placeholder, so distance means nothing.
  coordsUnreliable: boolean;
}

// A name match farther than this is suspect (same name, different place).
const NAME_MATCH_MAX_M = 1_000;
// Unnamed matches only when the points nearly coincide.
const NEARBY_MAX_M = 150;

const inNwa = (lat: number, lng: number) =>
  lat >= NWA_BOUNDS.minLat && lat <= NWA_BOUNDS.maxLat && lng >= NWA_BOUNDS.minLng && lng <= NWA_BOUNDS.maxLng;

const STREET_WORDS: Record<string, string> = {
  street: "st", drive: "dr", road: "rd", avenue: "ave", boulevard: "blvd", lane: "ln", place: "pl",
  parkway: "pkwy", court: "ct", circle: "cir", highway: "hwy", way: "way",
  north: "n", south: "s", east: "e", west: "w", northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
};

/** "5079 West Northgate Road," → "5079 w northgate rd", for comparing street addresses. */
export function normalizeStreetAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_WORDS[w] ?? w)
    .join(" ");
}

/**
 * Ticketmaster gives some venues a placeholder point (seen: one point shared
 * by six Fayetteville venues). A point shared by this many distinct venues is
 * treated as unreliable, and distance is ignored for them.
 */
export const PLACEHOLDER_SHARED_BY = 3;

export function placeholderPoints(tmVenues: readonly TmVenue[]): Set<string> {
  const counts = new Map<string, number>();
  for (const v of tmVenues) {
    if (v.lat === null || v.lng === null) continue;
    const key = `${v.lat},${v.lng}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n >= PLACEHOLDER_SHARED_BY).map(([k]) => k));
}

export function matchTicketmasterVenue(
  tm: TmVenue,
  ours: readonly OurVenue[],
  linked: ReadonlyMap<string, OurVenue>,
  placeholders: ReadonlySet<string> = new Set(),
): VenueMatch {
  const coordsUnreliable = tm.lat !== null && tm.lng !== null && placeholders.has(`${tm.lat},${tm.lng}`);
  const hasPoint = tm.lat !== null && tm.lng !== null && !coordsUnreliable;
  const dist = (v: OurVenue) => (hasPoint ? Math.round(distanceMeters({ lat: tm.lat!, lng: tm.lng! }, v)) : null);
  const result = (kind: MatchKind, venue: OurVenue | null): VenueMatch => ({
    tm,
    kind,
    venue,
    distanceM: venue ? dist(venue) : null,
    coordsUnreliable,
  });

  const link = linked.get(tm.id);
  if (link) return result("linked", link);
  if (hasPoint && !inNwa(tm.lat!, tm.lng!)) return result("outside_nwa", null);

  const city = (tm.city ?? "").toLowerCase();
  const sameCity = ours.filter((v) => v.city.toLowerCase() === city);
  const key = tm.name ? normalizeVenueName(tm.name) : "";
  const street = tm.address ? normalizeStreetAddress(tm.address) : "";
  const byName = sameCity.filter((v) => key && venueNameKeys(v).includes(key));
  const byAddress = sameCity.filter((v) => street && v.address && normalizeStreetAddress(v.address) === street);

  const both = byName.find((v) => byAddress.includes(v));
  if (both) return result("name", both);
  if (byAddress.length === 1) return result("address", byAddress[0]);
  if (byName.length > 0) {
    const best = [...byName].sort((a, b) => (dist(a) ?? 0) - (dist(b) ?? 0))[0];
    const d = dist(best);
    return result(d !== null && d > NAME_MATCH_MAX_M ? "name_far" : "name", best);
  }
  if (hasPoint) {
    const nearest = ours.map((v) => ({ v, d: dist(v)! })).sort((a, b) => a.d - b.d)[0];
    if (nearest && nearest.d <= NEARBY_MAX_M) return result("nearby", nearest.v);
  }
  return result("none", null);
}

/** Every Ticketmaster venue in stored payloads, with its event count. */
export async function ticketmasterVenuesInRawRecords(db: DbExecutor, sourceId: string): Promise<TmVenue[]> {
  const rows = await db
    .select({ payload: rawRecords.payload })
    .from(rawRecords)
    .where(and(eq(rawRecords.sourceId, sourceId), isNotNull(rawRecords.payload)));
  const byId = new Map<string, TmVenue>();
  for (const { payload } of rows) {
    const event = (payload as { event?: { venues?: Omit<TmVenue, "events">[] } } | null)?.event;
    for (const v of event?.venues ?? []) {
      const seen = byId.get(v.id);
      if (seen) seen.events++;
      else byId.set(v.id, { ...v, events: 1 });
    }
  }
  return [...byId.values()].sort((a, b) => b.events - a.events);
}

export async function ticketmasterCoverage(db: DbExecutor) {
  const [tm] = await db.select().from(sources).where(eq(sources.slug, "ticketmaster"));
  if (!tm) throw new Error("no ticketmaster source");
  const ours: OurVenue[] = await db
    .select({
      id: venues.id,
      slug: venues.slug,
      name: venues.name,
      aliases: venues.aliases,
      address: venues.address,
      city: venues.city,
      lat: venues.lat,
      lng: venues.lng,
    })
    .from(venues)
    .where(eq(venues.active, true));
  const links = await db
    .select({ externalId: venueExternalIds.externalId, venueId: venueExternalIds.venueId })
    .from(venueExternalIds)
    .where(eq(venueExternalIds.sourceId, tm.id));
  const byVenueId = new Map(ours.map((v) => [v.id, v]));
  const linked = new Map(links.flatMap((l) => (byVenueId.has(l.venueId) ? [[l.externalId, byVenueId.get(l.venueId)!]] : [])));
  const tmVenues = await ticketmasterVenuesInRawRecords(db, tm.id);
  const placeholders = placeholderPoints(tmVenues);
  return { sourceId: tm.id, matches: tmVenues.map((v) => matchTicketmasterVenue(v, ours, linked, placeholders)) };
}

/** Writes an approved link from a Ticketmaster venue ID to one of our venues, logged. */
export async function linkTicketmasterVenue(
  db: DbExecutor,
  opts: { sourceId: string; tmVenueId: string; venueSlug: string; actor: string; reason: string },
) {
  return db.transaction(async (tx) => {
    const [venue] = await tx.select().from(venues).where(eq(venues.slug, opts.venueSlug));
    if (!venue) throw new Error(`no venue ${opts.venueSlug}`);
    const [existing] = await tx
      .select()
      .from(venueExternalIds)
      .where(and(eq(venueExternalIds.sourceId, opts.sourceId), eq(venueExternalIds.externalId, opts.tmVenueId)));
    if (existing) throw new Error(`Ticketmaster venue ${opts.tmVenueId} is already linked`);
    const [created] = await tx
      .insert(venueExternalIds)
      .values({ venueId: venue.id, sourceId: opts.sourceId, externalId: opts.tmVenueId })
      .returning();
    await recordAction(tx, {
      actor: opts.actor,
      action: "insert",
      entityType: "venue_external_id",
      entityId: created.id,
      after: created,
      reason: opts.reason,
    });
    return created;
  });
}

/** Markdown report for the owner's review. */
export function coverageReport(matches: VenueMatch[], generatedAt: Date): string {
  const cell = (s: string | null | undefined) => (s ?? "").replaceAll("|", "\\|");
  const label: Record<MatchKind, string> = {
    linked: "linked",
    name: "**proposed** (same name, same city)",
    address: "**proposed** (same street address, same city)",
    name_far: "check: same name, but far apart",
    nearby: "**proposed** (within 150 m, different name)",
    none: "no match: new venue?",
    outside_nwa: "outside NWA (ignored)",
  };
  const events = (k: MatchKind[]) => matches.filter((m) => k.includes(m.kind)).reduce((n, m) => n + m.tm.events, 0);
  const total = events(["linked", "name", "address", "name_far", "nearby", "none", "outside_nwa"]);
  return [
    "# Ticketmaster venue coverage",
    "",
    `Generated ${generatedAt.toISOString()}. ${matches.length} Ticketmaster venues, ${total} events.`,
    "",
    `- Linked: ${events(["linked"])} events`,
    `- Proposed matches: ${events(["name", "address", "nearby"])} events`,
    `- Need a decision: ${events(["name_far", "none"])} events`,
    `- Outside NWA: ${events(["outside_nwa"])} events`,
    "",
    "Proposed links are written only after you approve them. Distance is blank when",
    "Ticketmaster's point is a placeholder shared by several venues.",
    "",
    "| TM venue id | TM name | TM address | city | events | status | our venue | our address | distance |",
    "|---|---|---|---|---|---|---|---|---|",
    ...matches.map(
      (m) =>
        `| ${m.tm.id} | ${cell(m.tm.name)} | ${cell(m.tm.address)} | ${cell(m.tm.city)} | ${m.tm.events} | ${label[m.kind]} | ` +
        `${m.venue?.slug ?? ""} | ${cell(m.venue?.address)} | ${m.distanceM === null ? (m.coordsUnreliable ? "TM point is a placeholder" : "") : `${m.distanceM} m`} |`,
    ),
    "",
  ].join("\n");
}

