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
  city: string;
  lat: number;
  lng: number;
}

export type MatchKind = "linked" | "name" | "name_far" | "nearby" | "none" | "outside_nwa";

export interface VenueMatch {
  tm: TmVenue;
  kind: MatchKind;
  venue: OurVenue | null;
  distanceM: number | null;
}

// A name match farther than this is suspect (same name, different place).
const NAME_MATCH_MAX_M = 1_000;
// Unnamed matches only when the points nearly coincide.
const NEARBY_MAX_M = 150;

const inNwa = (lat: number, lng: number) =>
  lat >= NWA_BOUNDS.minLat && lat <= NWA_BOUNDS.maxLat && lng >= NWA_BOUNDS.minLng && lng <= NWA_BOUNDS.maxLng;

export function matchTicketmasterVenue(tm: TmVenue, ours: readonly OurVenue[], linked: ReadonlyMap<string, OurVenue>): VenueMatch {
  const link = linked.get(tm.id);
  const hasPoint = tm.lat !== null && tm.lng !== null;
  const dist = (v: OurVenue) => (hasPoint ? Math.round(distanceMeters({ lat: tm.lat!, lng: tm.lng! }, v)) : null);
  if (link) return { tm, kind: "linked", venue: link, distanceM: dist(link) };
  if (hasPoint && !inNwa(tm.lat!, tm.lng!)) return { tm, kind: "outside_nwa", venue: null, distanceM: null };

  const key = tm.name ? normalizeVenueName(tm.name) : "";
  const city = (tm.city ?? "").toLowerCase();
  const byName = ours.filter((v) => key && v.city.toLowerCase() === city && venueNameKeys(v).includes(key));
  if (byName.length > 0) {
    const best = [...byName].sort((a, b) => (dist(a) ?? 0) - (dist(b) ?? 0))[0];
    const d = dist(best);
    return { tm, kind: d !== null && d > NAME_MATCH_MAX_M ? "name_far" : "name", venue: best, distanceM: d };
  }
  if (hasPoint) {
    const nearest = ours
      .map((v) => ({ v, d: dist(v)! }))
      .sort((a, b) => a.d - b.d)[0];
    if (nearest && nearest.d <= NEARBY_MAX_M) return { tm, kind: "nearby", venue: nearest.v, distanceM: nearest.d };
  }
  return { tm, kind: "none", venue: null, distanceM: null };
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
  return { sourceId: tm.id, matches: tmVenues.map((v) => matchTicketmasterVenue(v, ours, linked)) };
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
    name_far: "check: same name, but far apart",
    nearby: "**proposed** (within 150 m, different name)",
    none: "no match: new venue?",
    outside_nwa: "outside NWA (ignored)",
  };
  const events = (k: MatchKind[]) => matches.filter((m) => k.includes(m.kind)).reduce((n, m) => n + m.tm.events, 0);
  const total = events(["linked", "name", "name_far", "nearby", "none", "outside_nwa"]);
  return [
    "# Ticketmaster venue coverage",
    "",
    `Generated ${generatedAt.toISOString()}. ${matches.length} Ticketmaster venues, ${total} events.`,
    "",
    `- Linked: ${events(["linked"])} events`,
    `- Proposed matches: ${events(["name", "nearby"])} events`,
    `- Need a decision: ${events(["name_far", "none"])} events`,
    `- Outside NWA: ${events(["outside_nwa"])} events`,
    "",
    "Proposed links are written only after you approve them.",
    "",
    "| TM venue id | TM name | city | events | status | our venue | distance |",
    "|---|---|---|---|---|---|---|",
    ...matches.map(
      (m) =>
        `| ${m.tm.id} | ${cell(m.tm.name)} | ${cell(m.tm.city)} | ${m.tm.events} | ${label[m.kind]} | ${m.venue?.slug ?? ""} | ${m.distanceM === null ? "" : `${m.distanceM} m`} |`,
    ),
    "",
  ].join("\n");
}

