import { eq } from "drizzle-orm";
import { agentActor, recordAction } from "@/lib/actions/record";
import type { TaxonomyEntry } from "@/lib/categories";
import type { DbExecutor } from "@/lib/db/client";
import { rawRecords, venues } from "@/lib/db/schema";
import { formatInChicago } from "@/lib/time";
import { venueDisplayName } from "@/lib/venues/display";
import type { Facts } from "../map";
import { writeEvent } from "../write-event";
import { classifyEvent } from "./classify";
import { describeEvent } from "./describe";
import { type Extraction, extractFacts } from "./extract";
import type { Generate } from "./types";

/**
 * Turns a mapped record into an event (build step 13): extract facts from the
 * source's description (if any), classify, set the code-owned tags, describe
 * from the facts only, then write the event, logged. A description that reuses
 * source wording after one retry is held: the event goes live without one, and
 * a "hold" action records why.
 */

const ACTOR = agentActor("process");

export interface Taxonomy {
  categories: TaxonomyEntry[];
  tags: TaxonomyEntry[];
}

function priceText(min: number | null, max: number | null, isFree: boolean | null): string | null {
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
  const isFree = facts.price.min !== null || facts.price.max !== null ? false : (extraction?.isFree ?? null);
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
      performers: facts.performers,
      tags: deps.taxonomy.tags.filter((t) => tagSlugs.has(t.slug)).map((t) => t.name),
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
    extraction,
    descriptionHeld: described.status === "held",
  };
  const { event, created } = await writeEvent(
    db,
    record,
    {
      facts,
      venueId: venue.id,
      subSpace: record.subSpace,
      categoryId: category.id,
      tagIds,
      isFree,
      priceMin,
      priceMax,
      shortDescription: described.status === "ok" ? described.description : null,
    },
    {
      actor: ACTOR,
      runId: deps.runId,
      model: classified.model,
      llmCallId: classified.callId,
      reason: `Event from source record ${record.externalId}: ${category.slug}${tagSlugs.size ? ` [${[...tagSlugs].join(", ")}]` : ""}`,
      meta,
    },
  );
  if (described.status === "held") {
    await recordAction(db, {
      runId: deps.runId,
      actor: ACTOR,
      job: "process",
      action: "hold",
      entityType: "event_description",
      entityId: event.id,
      reason: `Generated description shared "${described.sharedRun}" with the source after ${described.attempts} attempts; held for review.`,
      model: described.model,
      llmCallId: described.callId,
    });
  }
  return { event, created, category: category.slug, tags: [...tagSlugs], held: described.status === "held" };
}
