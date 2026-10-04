import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/lib/db/client";
import { venueExternalIds, venues } from "@/lib/db/schema";
import { generateStructured, wrapUntrusted } from "@/lib/llm";
import type { SourceRow } from "@/lib/sources/types";
import { namesMatchClosely, normalizeVenueName, subSpaceName, venueNameKeys } from "@/lib/venues/normalize";
import { sameStreetAddress } from "@/lib/venues/street";
import type { Facts } from "./map";

/**
 * Finds the venue for a mapped record (plan section 5, rule 4). In order:
 *   1. external ID (venue_external_ids, e.g. Ticketmaster's venue ID)
 *   2. the source's default venue, but only when the location names it or is
 *      empty (a library's bookmobile isn't the library)
 *   3. alias: the location name is one of a venue's names, same city
 *   4. street address, same city (sameStreetAddress)
 *   5. trigram similarity on the name, same city, when one venue clearly wins
 *   6. an LLM pick among the top 5 trigram candidates, or "none"
 * No match means needs_venue. Venue coordinates always come from our own row.
 */

export type MatchedBy = "external_id" | "default_venue" | "alias" | "address" | "trigram" | "llm";

export interface Resolution {
  venueId: string;
  subSpace: string | null;
  matchedBy: MatchedBy;
}

export interface Candidate {
  id: string;
  slug: string;
  name: string;
  city: string;
  address: string | null;
  score: number;
}

/** Chooses one candidate's slug, or null for "none". Injected so tests don't call a model. */
export type LlmVenuePick = (args: { facts: Facts; candidates: Candidate[]; runId?: string | null }) => Promise<string | null>;

export const TRIGRAM_ACCEPT = 0.6;
export const TRIGRAM_MARGIN = 0.1;
export const TRIGRAM_CANDIDATE = 0.2;

type VenueRow = Pick<
  typeof venues.$inferSelect,
  "id" | "slug" | "name" | "aliases" | "address" | "formerAddresses" | "city" | "venueType"
>;

const sameCity = (v: VenueRow, city: string | null) => !city || v.city.toLowerCase() === city.toLowerCase();

export async function resolveVenue(
  db: DbExecutor,
  facts: Facts,
  source: Pick<SourceRow, "id" | "defaultVenueId">,
  deps: { llmPick?: LlmVenuePick; runId?: string | null } = {},
): Promise<Resolution | null> {
  const loc = facts.location;

  // 1. External ID.
  if (loc.externalVenueId) {
    const [link] = await db
      .select({ venueId: venueExternalIds.venueId, subSpace: venueExternalIds.subSpace })
      .from(venueExternalIds)
      .innerJoin(venues, eq(venues.id, venueExternalIds.venueId))
      .where(and(eq(venueExternalIds.sourceId, source.id), eq(venueExternalIds.externalId, loc.externalVenueId), eq(venues.active, true)));
    if (link) return { venueId: link.venueId, subSpace: link.subSpace ?? loc.room, matchedBy: "external_id" };
  }

  const all: VenueRow[] = await db
    .select({
      id: venues.id,
      slug: venues.slug,
      name: venues.name,
      aliases: venues.aliases,
      address: venues.address,
      formerAddresses: venues.formerAddresses,
      city: venues.city,
      venueType: venues.venueType,
    })
    .from(venues)
    .where(eq(venues.active, true));

  // 2. The source's default venue, when the location doesn't point elsewhere.
  if (source.defaultVenueId) {
    const def = all.find((v) => v.id === source.defaultVenueId);
    if (def && (!loc.name || namesMatchClosely(loc.name, def))) {
      return { venueId: def.id, subSpace: loc.room, matchedBy: "default_venue" };
    }
  }

  // A room named after the venue: "Rogers Historical Museum: Key Wing Education Center".
  const room = (v: VenueRow) => loc.room ?? subSpaceName(loc.name, v);
  const byAddress =
    loc.street && loc.city
      ? all.filter((v) => sameCity(v, loc.city) && [v.address, ...v.formerAddresses].some((a) => a && sameStreetAddress(loc.street!, a)))
      : [];

  // 3. Alias: one of the venue's names, in the same city. When the alias is an
  //    area ("Fayetteville Square") but the street address names a building
  //    on it (15 W Mountain: Fayetteville Town Center), the building wins.
  if (loc.name) {
    const key = normalizeVenueName(loc.name);
    const hits = all.filter((v) => sameCity(v, loc.city) && venueNameKeys(v).includes(key));
    if (hits.length === 1) {
      const building = byAddress.length === 1 && byAddress[0].venueType !== "area" ? byAddress[0] : null;
      if (hits[0].venueType === "area" && building) return { venueId: building.id, subSpace: loc.room, matchedBy: "address" };
      return { venueId: hits[0].id, subSpace: room(hits[0]), matchedBy: "alias" };
    }
  }

  // 4. Street address, same city.
  if (byAddress.length === 1) return { venueId: byAddress[0].id, subSpace: room(byAddress[0]), matchedBy: "address" };

  // 5. Trigram on the name, same city.
  if (!loc.name) return null;
  const candidates = await trigramCandidates(db, loc.name, loc.city);
  const [top, second] = candidates;
  if (top && top.score >= TRIGRAM_ACCEPT && (!second || top.score - second.score >= TRIGRAM_MARGIN)) {
    return { venueId: top.id, subSpace: loc.room, matchedBy: "trigram" };
  }

  // 6. LLM pick among the plausible candidates, or none.
  const plausible = candidates.filter((c) => c.score >= TRIGRAM_CANDIDATE);
  if (plausible.length === 0 || !deps.llmPick) return null;
  const slug = await deps.llmPick({ facts, candidates: plausible, runId: deps.runId });
  const chosen = plausible.find((c) => c.slug === slug);
  return chosen ? { venueId: chosen.id, subSpace: loc.room, matchedBy: "llm" } : null;
}

export async function trigramCandidates(db: DbExecutor, name: string, city: string | null): Promise<Candidate[]> {
  const score = sql<number>`similarity(lower(${venues.name}), lower(${name}))`;
  return db
    .select({ id: venues.id, slug: venues.slug, name: venues.name, city: venues.city, address: venues.address, score })
    .from(venues)
    .where(and(eq(venues.active, true), city ? sql`lower(${venues.city}) = lower(${city})` : sql`true`))
    .orderBy(sql`${score} desc`)
    .limit(5);
}

/** The production LLM pick: the model chooses one of our candidates by slug, or "none". */
export const llmVenuePick: LlmVenuePick = async ({ facts, candidates, runId }) => {
  const slugs = candidates.map((c) => c.slug) as [string, ...string[]];
  const schema = z.object({ venue: z.enum([...slugs, "none"]) });
  const list = candidates.map((c) => `- ${c.slug}: ${c.name}, ${c.address ?? "no street address"}, ${c.city}`).join("\n");
  const result = await generateStructured({
    task: "venue_pick",
    schema,
    schemaName: "venue_pick",
    system:
      "Decide which of our venues an event takes place at. Choose exactly one slug from the candidate list, " +
      'or "none" if none of them is clearly the same place. Prefer "none" over a guess.',
    input: `Candidate venues (ours, trusted):\n${list}\n\nThe event's location as the source wrote it:\n${wrapUntrusted("event location", [facts.title, facts.location.text ?? ""].join("\n"))}`,
    promptVersion: "venue_pick@1",
    runId,
  });
  return result.data.venue === "none" ? null : result.data.venue;
};
