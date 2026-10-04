import { and, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { agentActions, rawRecords, sources, venues } from "@/lib/db/schema";
import { proposeOnce } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { FetchBlockedError, FetchNotPermittedError } from "@/lib/http/fetch";
import { isWithinDomain, normalizeDomain } from "@/lib/http/domain";
import { wrapUntrusted } from "@/lib/llm";
import type { PoliteClient } from "@/lib/sources/http";
import { disableForBlock } from "./fetch";
import type { Facts } from "./map";
import { locationKey, parseLocation } from "./map/location";
import type { Generate } from "./enrich/types";
import { type LlmVenuePick, resolveVenue } from "./venue-resolve";

/**
 * Owner, 2026-10-04: before leaving a record in needs_venue because its
 * location is only a city or ZIP (or is prose, like a description pasted into
 * the location field), look for a specific place:
 *   1. the location field's own text, when it's prose;
 *   2. the event's own detail page on the same permitted source (normal rate
 *      limits and block rules: a block disables the source and stops), first
 *      its schema.org Place, then its description text.
 * A place found this way is never applied automatically. If it resolves to one
 * of our venues, a pending propose_venue_match goes to the owner; if not, a
 * pending propose_venue. Nothing from the page is stored: only the place's
 * name, street, and city, as values in the proposal.
 */

export const LOCATION_PROMPT_VERSION = "location@1";
const RECHECK_MS = 7 * 24 * 60 * 60_000;
const PLACEHOLDER_NAMES = /^(event location|location|tbd|tba|n\/?a|various( locations)?|see (description|details)|online)$/i;

export interface FoundPlace {
  name: string | null;
  street: string | null;
  city: string | null;
}

/** A location with no street and no usable name: just a city or ZIP, or prose. */
export function isVagueLocation(loc: Facts["location"]): boolean {
  if (loc.externalVenueId || loc.street) return false;
  return !loc.name || PLACEHOLDER_NAMES.test(loc.name.trim()) || looksLikeProse(loc.name);
}

/** "The City of Bentonville is pleased to offer..." is a sentence, not a place name. */
export function looksLikeProse(s: string): boolean {
  return s.split(/\s+/).length > 10 || /[.!?]\s+\p{Lu}/u.test(s);
}

const textOf = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();

/**
 * The schema.org Place in a page's microdata (CivicPlus detail pages carry
 * one): its name, street, and city. A placeholder name ("Event Location") is
 * no name. Null when the page has no Place.
 */
export function parsePlaceMicrodata(html: string): FoundPlace | null {
  const start = html.search(/itemprop=["']location["'][^>]*itemtype=["']https?:\/\/schema\.org\/Place["']/i);
  if (start < 0) return null;
  const end = html.slice(start).search(/<[^>]*itemprop=["'](performer|description|documents)["']/i);
  const block = html.slice(start, end > 0 ? start + end : start + 4_000);
  const prop = (name: string) => {
    const m = new RegExp(`itemprop=["']${name}["'][^>]*>([\\s\\S]*?)</(?:div|span|p)>`, "i").exec(block);
    const v = m ? textOf(m[1]) : "";
    return v || null;
  };
  const name = prop("name");
  return {
    name: name && !PLACEHOLDER_NAMES.test(name) ? name : null,
    street: prop("streetAddress"),
    city: prop("addressLocality"),
  };
}

/** The page's description text (microdata), capped. Read for a place only, never stored. */
export function pageDescriptionText(html: string): string | null {
  const start = html.search(/itemprop=["']description["']/i);
  if (start < 0) return null;
  const end = html.slice(start).search(/<[^>]*itemprop=["']documents["']/i);
  const text = textOf(html.slice(start, end > 0 ? start + end : start + 8_000).replace(/^[^>]*>/, ""));
  return text || null;
}

const placeSchema = z.object({
  name: z.string().trim().min(2).max(100).nullable(),
  street: z.string().trim().min(3).max(100).nullable(),
  city: z.string().trim().min(2).max(40).nullable(),
});

/** Asks the model for the place an event happens at, as values only; null if the text doesn't name one. */
export async function placeFromText(generate: Generate, title: string, text: string, runId?: string | null): Promise<FoundPlace | null> {
  const r = await generate({
    task: "extract",
    schema: placeSchema,
    schemaName: "event_place",
    system: [
      "Read an event listing and report where the event takes place, only if the text names a specific place.",
      "- name: the place's name (a park, building, square, or business), exactly as the text names it; null if none.",
      "- street: its street address if stated (\"200 NE A St\"); null otherwise. Never guess one.",
      "- city: its city if stated; null otherwise.",
      "Organizations, sponsors, and partners are not places. A city or ZIP alone is not a place: return all nulls.",
    ].join("\n"),
    input: `Event title: ${title}\n\n${wrapUntrusted("event listing", text, 4_000)}`,
    promptVersion: LOCATION_PROMPT_VERSION,
    runId,
  });
  const p = r.data;
  return p.name || p.street ? p : null;
}

const specific = (p: FoundPlace | null): p is FoundPlace => !!p && (!!p.street || (!!p.name && !looksLikeProse(p.name)));

export type DetailOutcome = "found_match" | "found_new" | "not_found" | "blocked" | "skipped";

/**
 * Looks for a specific place for one vague needs_venue record, then logs a
 * proposal if it finds one. Marks the record checked either way.
 */
export async function checkVagueLocation(
  db: DbExecutor,
  record: typeof rawRecords.$inferSelect,
  source: typeof sources.$inferSelect,
  deps: { http: PoliteClient; generate: Generate; llmPick?: LlmVenuePick; actor: string; runId?: string | null; now: Date },
): Promise<{ outcome: DetailOutcome; detail: string }> {
  const facts = record.facts as unknown as Facts;
  const markChecked = () => db.update(rawRecords).set({ locationCheckedAt: deps.now }).where(eq(rawRecords.id, record.id));
  let found: FoundPlace | null = null;
  let foundIn = "";

  // 1. The location field itself, when it's prose.
  if (facts.location.name && looksLikeProse(facts.location.name)) {
    found = await placeFromText(deps.generate, facts.title, facts.location.name, deps.runId);
    foundIn = "location_text";
  }

  // 2. The event's own detail page, on the same source.
  if (!specific(found)) {
    found = null;
    const domain = normalizeDomain(source.baseUrl);
    const url = facts.sourceUrl;
    if (!source.enabled) return { outcome: "skipped", detail: "source disabled" };
    if (!url || !domain || !isWithinDomain(new URL(url).hostname, domain)) {
      await markChecked();
      return { outcome: "skipped", detail: "no detail page on the source's own domain" };
    }
    let html: string;
    try {
      html = (await deps.http.get(url, "text/html")).text;
    } catch (err) {
      if (err instanceof FetchBlockedError || err instanceof FetchNotPermittedError) {
        await disableForBlock(db, source.id, deps.runId ?? null, err, deps.now, { actor: deps.actor, job: "process" });
        return { outcome: "blocked", detail: err.message };
      }
      throw err;
    }
    const place = parsePlaceMicrodata(html);
    if (specific(place)) {
      found = place;
      foundIn = "detail_page_place";
    } else {
      const text = pageDescriptionText(html);
      if (text) {
        const fromText = await placeFromText(deps.generate, facts.title, text, deps.runId);
        if (specific(fromText)) {
          found = fromText;
          foundIn = "detail_page_text";
        }
      }
    }
  }

  await markChecked();
  if (!specific(found)) return { outcome: "not_found", detail: "no specific place in the location text or detail page" };

  const place = { ...found, city: found.city ?? facts.location.city };
  const text = [place.name, place.street, place.city].filter(Boolean).join(", ");
  const parsed = parseLocation(null);
  const location = { ...parsed, text, name: place.name, street: place.street, city: place.city, externalVenueId: null };
  const venue = await resolveVenue(db, { ...facts, location }, source, { llmPick: deps.llmPick, runId: deps.runId });

  if (venue) {
    const [v] = await db.select({ slug: venues.slug, name: venues.name }).from(venues).where(eq(venues.id, venue.venueId));
    await proposeOnce(db, {
      runId: deps.runId ?? null,
      actor: deps.actor,
      action: "propose_venue_match",
      entityType: "raw_record",
      approvalStatus: "pending",
      dedupeKey: `match:${record.id}:${venue.venueId}`,
      after: { rawRecordId: record.id, venueId: venue.venueId, venueSlug: v.slug, subSpace: venue.subSpace, matchedBy: venue.matchedBy, place, foundIn, sourceUrl: facts.sourceUrl, title: facts.title },
      reason: `"${facts.title}" lists only "${facts.location.text ?? "no location"}"; its ${foundIn.replace(/_/g, " ")} names ${text}, which resolves to ${v.name} (${venue.matchedBy}).`,
    });
    return { outcome: "found_match", detail: `${text} → ${v.slug}` };
  }

  const key = locationKey(location);
  const [rejected] = await db
    .select({ id: agentActions.id })
    .from(agentActions)
    .where(and(eq(agentActions.action, "propose_venue"), eq(agentActions.dedupeKey, `venue:${key}`), eq(agentActions.approvalStatus, "rejected")))
    .limit(1);
  if (!rejected) {
    await proposeOnce(db, {
      runId: deps.runId ?? null,
      actor: deps.actor,
      action: "propose_venue",
      entityType: "venue",
      approvalStatus: "pending",
      dedupeKey: `venue:${key}`,
      after: { locationKey: key, locationText: text, records: 1, sampleTitles: [facts.title], foundIn, sourceUrl: facts.sourceUrl, rawRecordId: record.id },
      reason: `"${facts.title}" lists only "${facts.location.text ?? "no location"}"; its ${foundIn.replace(/_/g, " ")} names ${text}, which isn't one of our venues.`,
    });
  }
  return { outcome: "found_new", detail: text };
}

/** Vague needs_venue records due for a detail check: never checked, or not in the last week. */
export async function vagueRecordsDue(db: DbExecutor, now: Date, limit: number) {
  const rows = await db
    .select({ record: rawRecords, source: sources })
    .from(rawRecords)
    .innerJoin(sources, eq(sources.id, rawRecords.sourceId))
    .where(
      and(
        eq(rawRecords.status, "needs_venue"),
        or(isNull(rawRecords.locationCheckedAt), lt(rawRecords.locationCheckedAt, new Date(now.getTime() - RECHECK_MS))),
      ),
    );
  return rows.filter((r) => r.record.facts && isVagueLocation((r.record.facts as unknown as Facts).location)).slice(0, limit);
}
