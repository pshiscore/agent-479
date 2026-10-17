import { and, eq } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import { inCoverageArea } from "@/config/coverage";
import type { DbExecutor } from "@/lib/db/client";
import { eventProposals, events, type ProposedEvent, rawRecords, type SHADOW_FLAGS } from "@/lib/db/schema";
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

/** Update items are keyed apart from the record's original item. */
export const UPDATE_SUFFIX = "#update";

/** Pure: does the new draft change what readers rely on (date, time, or venue)? */
export function criticalChange(event: { startAt: Date; endAt: Date | null; allDay: boolean; venueId: string }, draft: EventDraft): string[] {
  const out: string[] = [];
  if (new Date(draft.facts.startAt).getTime() !== event.startAt.getTime()) out.push("start");
  if ((draft.facts.endAt ? new Date(draft.facts.endAt).getTime() : null) !== (event.endAt ? event.endAt.getTime() : null)) out.push("end");
  if (draft.facts.allDay !== event.allDay) out.push("all day");
  if (draft.venueId !== event.venueId) out.push("venue");
  return out;
}

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
    /** An update to a published event: kept apart from the record's original item. */
    updateOf?: string;
  },
): Promise<{ action: "created" | "updated" | "unchanged" | "decided" | "reopened" }> {
  const facts = proposedFromDraft(input.draft, input.tagSlugs, input.source.baseUrl);
  const flags: Flag[] = [];
  // An update item points at its own event, so it isn't a "possible duplicate" of it.
  if (!input.updateOf && (await likelyMatches(db, facts, 1)).length) flags.push("conflict");
  const outside = !inCoverageArea(input.venueCity);
  if (outside) flags.push("outside_coverage");
  if (input.categorySlug === "community") flags.push("community_fallback");
  if (input.descriptionHeld) flags.push("description_held");
  const reasons: string[] = [input.updateOf ? "shadow_update" : "shadow_source"];
  if (outside) reasons.push("outside_coverage_area");
  const externalId = input.updateOf ? `${input.record.externalId}${UPDATE_SUFFIX}` : input.record.externalId;
  const stored: ShadowDraft = { draft: input.draft, log: { runId: input.log.runId, model: input.log.model, llmCallId: input.log.llmCallId, reason: input.log.reason, meta: input.log.meta } };
  const sources = [{ url: facts.moreInfoUrl, fetchedAt: new Date().toISOString().slice(0, 10), sourceId: input.source.id }];
  const log = { actor: input.log.actor, runId: input.log.runId, model: input.log.model, llmCallId: input.log.llmCallId };

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(eventProposals)
      .where(and(eq(eventProposals.sourceId, input.source.id), eq(eventProposals.externalId, externalId)));
    if (!existing) {
      const [row] = await tx
        .insert(eventProposals)
        .values({
          origin: "shadow",
          reasons,
          facts,
          sources,
          sourceId: input.source.id,
          rawRecordId: input.record.id,
          externalId,
          draft: stored as unknown as Record<string, unknown>,
          flags,
          matchEventId: input.updateOf ?? null,
        })
        .returning();
      await recordAction(tx, {
        ...log,
        action: "insert",
        entityType: "event_proposal",
        entityId: row.id,
        after: row,
        reason: input.updateOf ? `Shadow update from ${input.source.slug} for a published event: ${facts.title}` : `Shadow item from ${input.source.slug}: ${facts.title}`,
      });
      return "created" as const;
    }
    // Key order differs once Postgres stores the JSON, so compare canonically.
    const same = canonicalJson(existing.facts) === canonicalJson(facts) && canonicalJson([...existing.flags].sort()) === canonicalJson([...flags].sort());
    if (existing.status !== "pending") {
      // A decided update comes back when the source changes the event again.
      if (!input.updateOf || same) return "decided" as const;
      const [after] = await tx
        .update(eventProposals)
        .set({ status: "pending", decidedAt: null, decidedBy: null, decisionNote: null, rejectKind: null, eventId: null, facts, flags, reasons, sources, rawRecordId: input.record.id, draft: stored as unknown as Record<string, unknown>, matchEventId: input.updateOf, updatedAt: new Date() })
        .where(eq(eventProposals.id, existing.id))
        .returning();
      await recordAction(tx, { ...log, action: "update", entityType: "event_proposal", entityId: existing.id, before: existing, after, reason: `Shadow update reopened: ${input.source.slug} changed the event again` });
      return "reopened" as const;
    }
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

/**
 * After a successful fetch of a shadow source: events the owner approved from
 * it that the feed no longer lists, within the dates the feed currently
 * covers, are hidden right away and logged. Only approved shadow items are
 * considered, so series expansions and events beyond a feed's window are left
 * alone. Returns how many were hidden.
 */
export async function hideRemovedShadowEvents(
  db: DbExecutor,
  source: { id: string; slug: string },
  fetched: { externalIds: string[]; lastStart: Date | null },
  opts: { actor: string; runId: string | null; now: Date },
): Promise<number> {
  if (!fetched.lastStart) return 0;
  const present = new Set(fetched.externalIds);
  const approved = await db
    .select({ externalId: eventProposals.externalId, eventId: eventProposals.eventId })
    .from(eventProposals)
    .where(and(eq(eventProposals.sourceId, source.id), eq(eventProposals.origin, "shadow"), eq(eventProposals.status, "approved")));
  let hidden = 0;
  for (const a of approved) {
    if (!a.eventId || !a.externalId || a.externalId.endsWith(UPDATE_SUFFIX) || present.has(a.externalId)) continue;
    const [before] = await db.select().from(events).where(eq(events.id, a.eventId));
    if (!before || before.status !== "scheduled" || before.startAt < opts.now || before.startAt > fetched.lastStart) continue;
    await db.transaction(async (tx) => {
      const [after] = await tx.update(events).set({ status: "hidden", updatedAt: opts.now }).where(eq(events.id, before.id)).returning();
      await recordAction(tx, { actor: opts.actor, runId: opts.runId, action: "update", entityType: "event", entityId: before.id, before, after, reason: `Hidden: no longer listed by ${source.slug} (an approved shadow event)` });
    });
    hidden++;
  }
  return hidden;
}
