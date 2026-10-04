import { and, eq, like } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { eventSources, events, eventTags, rawRecords } from "@/lib/db/schema";
import { slugify } from "@/lib/slug";
import { normalizeVenueName } from "@/lib/venues/normalize";
import type { Facts } from "./map";

/**
 * Writes one event from an enriched raw record, with its source row and tags,
 * in one transaction, logged row by row (AGENTS.md rule 2): insert with the
 * full row, or update with before and after. Tags are part of both snapshots,
 * so a rollback restores them. The record moves to "extracted".
 */

export interface EventDraft {
  facts: Facts;
  venueId: string;
  subSpace: string | null;
  categoryId: string;
  tagIds: string[];
  isFree: boolean | null;
  freeBasis: "stated" | "source_default" | null;
  ageMin: number | null;
  ageMax: number | null;
  gradeMin: number | null;
  gradeMax: number | null;
  registrationRequired: boolean | null;
  priceMin: number | null;
  priceMax: number | null;
  shortDescription: string | null;
}

export interface WriteLog {
  actor: string;
  runId?: string | null;
  model?: string | null;
  llmCallId?: string | null;
  reason: string;
  // Recorded on the action (e.g. the Community hint and every LLM call id).
  meta: Record<string, unknown>;
}

type EventRow = typeof events.$inferSelect;

async function uniqueSlug(tx: DbExecutor, base: string): Promise<string> {
  const taken = new Set((await tx.select({ slug: events.slug }).from(events).where(like(events.slug, `${base}%`))).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

async function snapshot(tx: DbExecutor, event: EventRow) {
  const tags = await tx.select({ tagId: eventTags.tagId }).from(eventTags).where(eq(eventTags.eventId, event.id));
  return { ...event, tagIds: tags.map((t) => t.tagId).sort() };
}

export async function writeEvent(
  db: DbExecutor,
  record: Pick<typeof rawRecords.$inferSelect, "id" | "sourceId" | "externalId" | "eventId">,
  draft: EventDraft,
  log: WriteLog,
): Promise<{ event: EventRow; created: boolean }> {
  const f = draft.facts;
  const fields = {
    title: f.title,
    normalizedTitle: normalizeVenueName(f.title),
    shortDescription: draft.shortDescription,
    startAt: new Date(f.startAt),
    endAt: f.endAt ? new Date(f.endAt) : null,
    allDay: f.allDay,
    timeTba: f.timeTba,
    venueId: draft.venueId,
    subSpace: draft.subSpace,
    categoryId: draft.categoryId,
    isFree: draft.isFree,
    freeBasis: draft.freeBasis,
    ageMin: draft.ageMin,
    ageMax: draft.ageMax,
    gradeMin: draft.gradeMin,
    gradeMax: draft.gradeMax,
    registrationRequired: draft.registrationRequired,
    priceMin: draft.priceMin,
    priceMax: draft.priceMax,
    primarySourceUrl: f.sourceUrl,
    ticketUrl: f.ticketUrl,
    status: f.status,
  } as const;
  const now = new Date();

  return db.transaction(async (tx) => {
    // The record's own event, or one already linked to this (source, external id).
    let existing: EventRow | undefined;
    if (record.eventId) [existing] = await tx.select().from(events).where(eq(events.id, record.eventId));
    if (!existing) {
      const [link] = await tx
        .select({ eventId: eventSources.eventId })
        .from(eventSources)
        .where(and(eq(eventSources.sourceId, record.sourceId), eq(eventSources.externalId, record.externalId)));
      if (link) [existing] = await tx.select().from(events).where(eq(events.id, link.eventId));
    }

    let event: EventRow;
    let created = false;
    if (existing) {
      const before = await snapshot(tx, existing);
      [event] = await tx.update(events).set({ ...fields, lastSeenAt: now }).where(eq(events.id, existing.id)).returning();
      await tx.delete(eventTags).where(eq(eventTags.eventId, event.id));
      if (draft.tagIds.length) await tx.insert(eventTags).values(draft.tagIds.map((tagId) => ({ eventId: event.id, tagId })));
      await recordAction(tx, {
        runId: log.runId,
        actor: log.actor,
        job: "process",
        action: "update",
        entityType: "event",
        entityId: event.id,
        before,
        after: { ...(await snapshot(tx, event)), _meta: log.meta },
        reason: log.reason,
        model: log.model,
        llmCallId: log.llmCallId,
      });
    } else {
      const slug = await uniqueSlug(tx, `${slugify(f.title)}-${f.startAt.slice(0, 10)}`);
      [event] = await tx.insert(events).values({ ...fields, slug, firstSeenAt: now, lastSeenAt: now }).returning();
      if (draft.tagIds.length) await tx.insert(eventTags).values(draft.tagIds.map((tagId) => ({ eventId: event.id, tagId })));
      await recordAction(tx, {
        runId: log.runId,
        actor: log.actor,
        job: "process",
        action: "insert",
        entityType: "event",
        entityId: event.id,
        after: { ...(await snapshot(tx, event)), _meta: log.meta },
        reason: log.reason,
        model: log.model,
        llmCallId: log.llmCallId,
      });
      created = true;
    }

    await tx
      .insert(eventSources)
      .values({
        eventId: event.id,
        sourceId: record.sourceId,
        rawRecordId: record.id,
        externalId: record.externalId,
        sourceUrl: f.sourceUrl,
        ticketUrl: f.ticketUrl,
        isPrimary: created,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [eventSources.sourceId, eventSources.externalId],
        set: { rawRecordId: record.id, sourceUrl: f.sourceUrl, ticketUrl: f.ticketUrl, lastSeenAt: now },
      });
    await tx.update(rawRecords).set({ status: "extracted", eventId: event.id }).where(eq(rawRecords.id, record.id));
    return { event, created };
  });
}
