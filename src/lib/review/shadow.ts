import { and, eq } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import { inCoverageArea } from "@/config/coverage";
import type { DbExecutor } from "@/lib/db/client";
import { eventProposals, type ProposedEvent, rawRecords, type SHADOW_FLAGS } from "@/lib/db/schema";
import { CODE_SET_TAGS } from "@/lib/pipeline/enrich/classify";
import type { EventDraft, WriteLog } from "@/lib/pipeline/write-event";
import { canonicalJson } from "@/lib/venues/seed-file";
import { likelyMatches } from "./proposals";

/**
 * Shadow mode (owner, 2026-10-16). A source in shadow is fetched and processed
 * like any other (venue, category, tags, description, dedup checks), but its
 * events stop here: each becomes one review item, keyed by source record, and
 * nothing publishes until the owner approves the item or promotes the source.
 * Approving an item publishes this exact draft through writeEvent.
 */

type Flag = (typeof SHADOW_FLAGS)[number];

/** What a shadow item stores so approval can publish it unchanged. */
export interface ShadowDraft {
  draft: EventDraft;
  log: Pick<WriteLog, "runId" | "model" | "llmCallId" | "reason" | "meta">;
}

/** The review queue's view of a processed event. */
export function proposedFromDraft(d: EventDraft, tagSlugs: string[], fallbackUrl: string): ProposedEvent {
  const f = d.facts;
  return {
    title: f.title,
    startAt: new Date(f.startAt).toISOString(),
    endAt: f.endAt ? new Date(f.endAt).toISOString() : null,
    allDay: f.allDay,
    venueId: d.venueId,
    subSpace: d.subSpace,
    categoryId: d.categoryId,
    isFree: d.isFree,
    priceMin: d.priceMin,
    priceMax: d.priceMax,
    ageMin: d.ageMin,
    ageMax: d.ageMax,
    registrationRequired: d.registrationRequired,
    inSpanish: tagSlugs.includes("en-espanol"),
    tagSlugs: tagSlugs.filter((t) => !CODE_SET_TAGS.has(t)),
    ticketUrl: f.ticketUrl,
    moreInfoUrl: f.sourceUrl ?? fallbackUrl,
    dailyHours: [],
  };
}

/**
 * Creates or refreshes the review item for one shadow record. A pending item
 * is updated (and logged) only when what it shows changed; a decided item is
 * left alone, so a rejected event doesn't come back on the next fetch.
 */
export async function upsertShadowItem(
  db: DbExecutor,
  input: {
    source: { id: string; slug: string; baseUrl: string };
    record: { id: string; externalId: string };
    draft: EventDraft;
    log: ShadowDraft["log"] & { actor: string };
    venueCity: string;
    categorySlug: string;
    tagSlugs: string[];
    descriptionHeld: boolean;
  },
): Promise<{ action: "created" | "updated" | "unchanged" | "decided" }> {
  const facts = proposedFromDraft(input.draft, input.tagSlugs, input.source.baseUrl);
  const flags: Flag[] = [];
  if ((await likelyMatches(db, facts, 1)).length) flags.push("conflict");
  const outside = !inCoverageArea(input.venueCity);
  if (outside) flags.push("outside_coverage");
  if (input.categorySlug === "community") flags.push("community_fallback");
  if (input.descriptionHeld) flags.push("description_held");
  const reasons = outside ? ["shadow_source", "outside_coverage_area"] : ["shadow_source"];
  const stored: ShadowDraft = { draft: input.draft, log: { runId: input.log.runId, model: input.log.model, llmCallId: input.log.llmCallId, reason: input.log.reason, meta: input.log.meta } };
  const sources = [{ url: facts.moreInfoUrl, fetchedAt: new Date().toISOString().slice(0, 10), sourceId: input.source.id }];
  const log = { actor: input.log.actor, runId: input.log.runId, model: input.log.model, llmCallId: input.log.llmCallId };

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(eventProposals)
      .where(and(eq(eventProposals.sourceId, input.source.id), eq(eventProposals.externalId, input.record.externalId)));
    if (!existing) {
      const [row] = await tx
        .insert(eventProposals)
        .values({ origin: "shadow", reasons, facts, sources, sourceId: input.source.id, rawRecordId: input.record.id, externalId: input.record.externalId, draft: stored as unknown as Record<string, unknown>, flags })
        .returning();
      await recordAction(tx, { ...log, action: "insert", entityType: "event_proposal", entityId: row.id, after: row, reason: `Shadow item from ${input.source.slug}: ${facts.title}` });
      return "created" as const;
    }
    if (existing.status !== "pending") return "decided" as const;
    // Key order differs once Postgres stores the JSON, so compare canonically.
    const same = canonicalJson(existing.facts) === canonicalJson(facts) && canonicalJson([...existing.flags].sort()) === canonicalJson([...flags].sort());
    if (same) return "unchanged" as const;
    const [after] = await tx
      .update(eventProposals)
      .set({ facts, flags, reasons, sources, rawRecordId: input.record.id, draft: stored as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(eventProposals.id, existing.id))
      .returning();
    await recordAction(tx, { ...log, action: "update", entityType: "event_proposal", entityId: existing.id, before: existing, after, reason: `Shadow item refreshed from ${input.source.slug}` });
    return "updated" as const;
  });
  await db.update(rawRecords).set({ status: "extracted", eventId: null }).where(eq(rawRecords.id, input.record.id));
  return { action: result };
}

/** Owner edits from "Edit and approve", applied to a shadow draft before it publishes. */
export function applyEditsToDraft(draft: EventDraft, edits: Partial<ProposedEvent>): EventDraft {
  const f = { ...draft.facts };
  if (edits.title !== undefined) f.title = edits.title;
  if (edits.startAt !== undefined) f.startAt = edits.startAt;
  if (edits.endAt !== undefined) f.endAt = edits.endAt;
  if (edits.allDay !== undefined) f.allDay = edits.allDay;
  if (edits.ticketUrl !== undefined) f.ticketUrl = edits.ticketUrl;
  if (edits.moreInfoUrl !== undefined) f.sourceUrl = edits.moreInfoUrl;
  return {
    ...draft,
    facts: f,
    venueId: edits.venueId ?? draft.venueId,
    subSpace: edits.subSpace !== undefined ? edits.subSpace : draft.subSpace,
    categoryId: edits.categoryId ?? draft.categoryId,
    isFree: edits.isFree !== undefined ? edits.isFree : draft.isFree,
    freeBasis: edits.isFree === undefined ? draft.freeBasis : edits.isFree ? (draft.freeBasis ?? "stated") : null,
    priceMin: edits.priceMin !== undefined ? edits.priceMin : draft.priceMin,
    priceMax: edits.priceMax !== undefined ? edits.priceMax : draft.priceMax,
    ageMin: edits.ageMin !== undefined ? edits.ageMin : draft.ageMin,
    ageMax: edits.ageMax !== undefined ? edits.ageMax : draft.ageMax,
    registrationRequired: edits.registrationRequired !== undefined ? edits.registrationRequired : draft.registrationRequired,
  };
}
