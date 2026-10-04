import { desc, eq, inArray } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { dedupCandidates, eventSources, events, eventTags, sources } from "@/lib/db/schema";

/**
 * Merging two events (plan section 6, rule 6). Nothing is deleted:
 * - the loser gets status merged and canonical_event_id = the survivor;
 * - its event_sources rows move to the survivor (never primary);
 * - the survivor's empty fields are filled from the loser, and tags are joined;
 * - one agent_actions row holds the full before-state of both events, their
 *   tags, and their source rows, so the merge can be undone.
 * Only runs for pairs in live mode; in shadow mode nothing calls it.
 */

type EventRow = typeof events.$inferSelect;

// Filled on the survivor when it has none. Free and its basis move together.
const FILLABLE = [
  "endAt",
  "subSpace",
  "shortDescription",
  "ageMin",
  "ageMax",
  "gradeMin",
  "gradeMax",
  "registrationRequired",
  "priceMin",
  "priceMax",
  "priceText",
  "ticketUrl",
  "primarySourceUrl",
] as const;

/** The event whose primary source we trust more survives; then the one seen first. */
export async function chooseSurvivor(db: DbExecutor, a: EventRow, b: EventRow): Promise<{ survivor: EventRow; loser: EventRow }> {
  const trust = async (e: EventRow) => {
    const [row] = await db
      .select({ trust: sources.trustLevel })
      .from(eventSources)
      .innerJoin(sources, eq(sources.id, eventSources.sourceId))
      .where(eq(eventSources.eventId, e.id))
      .orderBy(desc(eventSources.isPrimary))
      .limit(1);
    return row?.trust ?? 0;
  };
  const [ta, tb] = [await trust(a), await trust(b)];
  if (ta !== tb) return ta > tb ? { survivor: a, loser: b } : { survivor: b, loser: a };
  return a.firstSeenAt.getTime() <= b.firstSeenAt.getTime() ? { survivor: a, loser: b } : { survivor: b, loser: a };
}

export async function mergeEvents(
  db: DbExecutor,
  input: { survivorId: string; loserId: string; candidateId: string | null; actor: string; runId?: string | null; reason: string; now: Date },
) {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(events).where(inArray(events.id, [input.survivorId, input.loserId]));
    const survivor = rows.find((r) => r.id === input.survivorId);
    const loser = rows.find((r) => r.id === input.loserId);
    if (!survivor || !loser) throw new Error("merge: both events must exist");
    if (survivor.status === "merged" || loser.status === "merged") throw new Error("merge: an event is already merged");

    const tagsOf = async (id: string) => (await tx.select({ tagId: eventTags.tagId }).from(eventTags).where(eq(eventTags.eventId, id))).map((t) => t.tagId).sort();
    const sourcesOf = (id: string) => tx.select().from(eventSources).where(eq(eventSources.eventId, id));
    const before = {
      survivor: { ...survivor, tagIds: await tagsOf(survivor.id), sources: await sourcesOf(survivor.id) },
      loser: { ...loser, tagIds: await tagsOf(loser.id), sources: await sourcesOf(loser.id) },
    };

    const fill: Partial<EventRow> = {};
    for (const k of FILLABLE) if (survivor[k] == null && loser[k] != null) Object.assign(fill, { [k]: loser[k] });
    if (survivor.isFree == null && loser.isFree != null) Object.assign(fill, { isFree: loser.isFree, freeBasis: loser.freeBasis });

    const [survivorAfter] = await tx.update(events).set({ ...fill, updatedAt: input.now }).where(eq(events.id, survivor.id)).returning();
    const [loserAfter] = await tx
      .update(events)
      .set({ status: "merged", canonicalEventId: survivor.id, updatedAt: input.now })
      .where(eq(events.id, loser.id))
      .returning();
    await tx.update(eventSources).set({ eventId: survivor.id, isPrimary: false }).where(eq(eventSources.eventId, loser.id));
    const newTags = before.loser.tagIds.filter((t) => !before.survivor.tagIds.includes(t));
    if (newTags.length) await tx.insert(eventTags).values(newTags.map((tagId) => ({ eventId: survivor.id, tagId })));
    if (input.candidateId) {
      await tx.update(dedupCandidates).set({ mode: "live", resolvedAt: input.now, resolvedBy: input.actor }).where(eq(dedupCandidates.id, input.candidateId));
    }

    await recordAction(tx, {
      runId: input.runId,
      actor: input.actor,
      job: "process",
      action: "merge",
      entityType: "event",
      entityId: survivor.id,
      before,
      after: {
        survivor: { ...survivorAfter, tagIds: await tagsOf(survivor.id), sources: await sourcesOf(survivor.id), filled: Object.keys(fill) },
        loser: { ...loserAfter, tagIds: before.loser.tagIds, sources: [] },
        candidateId: input.candidateId,
      },
      reason: input.reason,
    });
    return { survivor: survivorAfter, loser: loserAfter, filled: Object.keys(fill) };
  });
}
