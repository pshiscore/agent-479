import { and, eq } from "drizzle-orm";
import { agentActor, recordAction } from "@/lib/actions/record";
import type { TaxonomyEntry } from "@/lib/categories";
import type { DbExecutor } from "@/lib/db/client";
import { events, eventSources, rawRecords, sources, venues } from "@/lib/db/schema";
import { inCoverageArea } from "@/config/coverage";
import { criticalChange, upsertShadowItem } from "@/lib/review/shadow";
import { isTicketingUrl } from "@/lib/ticketing";
import { formatInChicago } from "@/lib/time";
import { venueDisplayName } from "@/lib/venues/display";
import type { Facts } from "../map";
import { writeEvent } from "../write-event";
import { classifyEvent } from "./classify";
import { describeEvent, newAges, newPerformers } from "./describe";
import { type Extraction, extractFacts } from "./extract";
import { decideFree } from "./free";
import { proposeGlossaryEntries } from "./glossary-proposals";
import type { Generate } from "./types";

/**
 * Turns a mapped record into an event (build step 13): extract facts from the
 * source's description (if any), classify, set the code-owned tags, describe
 * from the facts only (or leave the description empty when there's no fact to
 * add beyond the title and category), then write the event, logged. A description that reuses
 * source wording after one retry is held: the event goes live without one, and
 * a "hold" action records why.
 */

const ACTOR = agentActor("process");

export interface Taxonomy {
  categories: TaxonomyEntry[];
  tags: TaxonomyEntry[];
}

export function priceText(min: number | null, max: number | null, isFree: boolean | null): string | null {
  if (isFree) return "Free";
  if (min === null && max === null) return null;
  const f = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  if (min !== null && max !== null && max > min) return `${f(min)}–${f(max)}`;
  return f((min ?? max)!);
}

export async function enrichRecord(
  db: DbExecutor,
  record: typeof rawRecords.$inferSelect,
  deps: { generate: Generate; taxonomy: Taxonomy; runId?: string | null },
) {
  const facts = record.facts as unknown as Facts;
  const [venue] = await db.select().from(venues).where(eq(venues.id, record.venueId!));
  const [source] = await db
    .select({ id: sources.id, slug: sources.slug, baseUrl: sources.baseUrl, defaultPriceNote: sources.defaultPriceNote, publishState: sources.publishState })
    .from(sources)
    .where(eq(sources.id, record.sourceId));
  const description = record.descriptionText;

  // 1. Extract (only when there's a description to read).
  let extraction: Extraction | null = null;
  let extractCallId: string | null = null;
  if (description) {
    const r = await extractFacts(deps.generate, facts, description, deps.runId);
    extraction = r.data;
    extractCallId = r.callId;
  }

  // Structured prices (Ticketmaster) beat extracted ones.
  const priceMin = facts.price.min ?? extraction?.priceMin ?? null;
  const priceMax = facts.price.max ?? extraction?.priceMax ?? null;
  const free = decideFree(facts, extraction, description, source?.defaultPriceNote ?? null);
  const isFree = free.isFree;
  const adultsOnly = extraction?.ageRestriction === "21_plus" || facts.legalAgeEnforced === true;

  // 2. Classify.
  const classified = await classifyEvent(
    deps.generate,
    { facts, venueName: venue.name, venueType: venue.venueType, extraction, description },
    deps.taxonomy,
    deps.runId,
  );

  // 3. Tags: the model's, plus the ones code owns.
  const tagSlugs = new Set(classified.data.tags);
  if (isFree) tagSlugs.add("free");
  if (adultsOnly) tagSlugs.add("21-plus");
  if (extraction?.familyFriendly) tagSlugs.add("family-friendly");
  if (adultsOnly) tagSlugs.delete("family-friendly");
  if (extraction?.registrationRequired) tagSlugs.add("registration-required");
  if (isTicketingUrl(facts.ticketUrl)) tagSlugs.add("ticketed");
  if (extraction?.spanish) tagSlugs.add("en-espanol");
  const tagIds = deps.taxonomy.tags.filter((t) => tagSlugs.has(t.slug)).map((t) => t.id);
  const category = deps.taxonomy.categories.find((c) => c.slug === classified.data.category)!;

  // 4. Describe, from the facts only.
  const when = formatInChicago(new Date(facts.startAt), {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(facts.allDay || facts.timeTba ? {} : { hour: "numeric", minute: "2-digit" }),
  });
  const described = await describeEvent(
    deps.generate,
    {
      title: facts.title,
      when: facts.timeTba ? `${when} (time to be announced)` : facts.allDay ? `${when} (all day)` : when,
      venue: venueDisplayName(venue.name, record.subSpace),
      city: venue.city,
      category: category.name,
      price: priceText(priceMin, priceMax, isFree),
      tags: deps.taxonomy.tags.filter((t) => tagSlugs.has(t.slug)).map((t) => t.name),
      performers: newPerformers(facts.title, facts.performers),
      ages: extraction ? newAges(facts.title, extraction) : null,
      activity: extraction?.activity ?? null,
      registrationRequired: extraction?.registrationRequired ?? null,
    },
    description,
    deps.runId,
  );

  // 5. Write the event, logged.
  const meta = {
    extractCallId,
    classifyCallId: classified.callId,
    describeCallId: described.callId,
    closestMissingCategory: classified.data.closestMissingCategory,
    freeBasis: free.basis,
    extraction,
    descriptionHeld: described.status === "held",
    descriptionStatus: described.status,
    descriptionFacts: described.status === "ok" ? described.usedFacts : null,
    descriptionNoneReason: described.status === "none" ? described.reason : null,
  };
  const draft = {
      facts,
      venueId: venue.id,
      subSpace: record.subSpace,
      categoryId: category.id,
      tagIds,
      isFree,
      freeBasis: free.basis,
      ageMin: extraction?.ageMin ?? null,
      ageMax: extraction?.ageMax ?? null,
      gradeMin: extraction?.gradeMin ?? null,
      gradeMax: extraction?.gradeMax ?? null,
      registrationRequired: extraction?.registrationRequired ?? null,
      priceMin,
      priceMax,
      shortDescription: described.status === "ok" ? described.description : null,
    };
  const log = {
      actor: ACTOR,
      runId: deps.runId,
      model: classified.model,
      llmCallId: classified.callId,
      reason: `Event from source record ${record.externalId}: ${category.slug}${tagSlugs.size ? ` [${[...tagSlugs].join(", ")}]` : ""}`,
      meta,
    };

  // Shadow mode (owner, 2026-10-16): a source that isn't live sends new events to
  // review instead of publishing. A record already tied to a published event (the
  // owner approved it) keeps updating that event.
  // Out-of-area events (owner, 2026-10-17), from any source, are held in review and never publish.
  const linked = await linkedEventId(db, record);
  const outside = !inCoverageArea(venue.city);
  const shadowInput = { source, record, draft, log, venueCity: venue.city, categorySlug: category.slug, tagSlugs: [...tagSlugs], descriptionHeld: described.status === "held" };
  const result = (shadow: string) => ({ event: null, created: false, shadow, category: category.slug, tags: [...tagSlugs], held: described.status === "held" });
  if (!linked && (outside || source.publishState !== "live")) {
    return result((await upsertShadowItem(db, shadowInput)).action);
  }
  // An event already published from this record: while its source is in shadow (or
  // when it would move out of the area), a changed date, time, or venue waits for
  // the owner as an update item; a cancellation applies at once (it hides the event).
  if (linked && (outside || source.publishState !== "live") && draft.facts.status === "scheduled") {
    const [current] = await db.select().from(events).where(eq(events.id, linked));
    if (current && (outside || criticalChange(current, draft).length)) {
      return result((await upsertShadowItem(db, { ...shadowInput, updateOf: linked })).action);
    }
  }

  const { event, created } = await writeEvent(db, record, draft, log);
  if (described.status !== "none" && described.glossaryCandidates.length) {
    await proposeGlossaryEntries(db, described.glossaryCandidates, { actor: ACTOR, runId: deps.runId, eventTitle: facts.title });
  }
  if (described.status === "held") {
    await recordAction(db, {
      runId: deps.runId,
      actor: ACTOR,
      job: "process",
      action: "hold",
      entityType: "event_description",
      entityId: event.id,
      reason: `Generated description failed its checks after ${described.attempts} attempts (${described.problem}); held for review.`,
      model: described.model,
      llmCallId: described.callId,
    });
  }
  return { event, created, shadow: null, category: category.slug, tags: [...tagSlugs], held: described.status === "held" };
}

/** The published event a source record already belongs to, if any. */
async function linkedEventId(db: DbExecutor, record: Pick<typeof rawRecords.$inferSelect, "eventId" | "sourceId" | "externalId">): Promise<string | null> {
  if (record.eventId) return record.eventId;
  const [link] = await db
    .select({ eventId: eventSources.eventId })
    .from(eventSources)
    .where(and(eq(eventSources.sourceId, record.sourceId), eq(eventSources.externalId, record.externalId)));
  return link?.eventId ?? null;
}
