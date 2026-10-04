import { eq } from "drizzle-orm";
import type { DbExecutor } from "@/lib/db/client";
import { agentActions, dedupCandidates, eventSources, events, eventTags, sources } from "@/lib/db/schema";
import { type AgentAction, recordAction } from "./record";

/**
 * Undoing a logged action from /admin (AGENTS.md rule 2: every automated write
 * can be rolled back). What can be undone here:
 *   event update    → the event's columns and tags as they were before
 *   event insert    → the event is hidden (events are never deleted)
 *   event merge     → unmerge: both events, their tags and source rows as
 *                     they were before the merge
 *   source enable / disable / update → enabled and disabled_reason as before
 * Each refuses when the entity has changed since the action (undo the later
 * change first), or when the action was already rolled back. The rollback is
 * itself logged, linked both ways (reverts_action_id, reverted_by_action_id).
 */

export class RollbackError extends Error {}

type Revertible = { ok: true; label: string } | { ok: false; why: string };

const EVENT_FIELDS = [
  "title", "normalizedTitle", "shortDescription", "startAt", "endAt", "allDay", "timeTba", "venueId", "subSpace", "categoryId", "seriesId",
  "isFree", "freeBasis", "ageMin", "ageMax", "gradeMin", "gradeMax", "registrationRequired", "priceMin", "priceMax", "priceText",
  "primarySourceUrl", "ticketUrl", "status", "canonicalEventId",
] as const;
type EventRow = typeof events.$inferSelect;
type Snapshot = Partial<Record<(typeof EVENT_FIELDS)[number], unknown>> & { tagIds?: string[] };

// Snapshots went through JSON: dates are strings there. Compare and restore in that form.
const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined ? null : v);
const toColumn = (k: string, v: unknown) => (["startAt", "endAt"].includes(k) && typeof v === "string" ? new Date(v) : v);

function eventFieldsFrom(snapshot: Snapshot): Partial<EventRow> {
  return Object.fromEntries(EVENT_FIELDS.filter((k) => k in snapshot).map((k) => [k, toColumn(k, snapshot[k])])) as Partial<EventRow>;
}

function sameEvent(current: EventRow, tagIds: string[], snapshot: Snapshot): boolean {
  const fields = EVENT_FIELDS.filter((k) => k in snapshot).every((k) => JSON.stringify(norm(current[k])) === JSON.stringify(norm(snapshot[k])));
  return fields && (!snapshot.tagIds || JSON.stringify([...tagIds].sort()) === JSON.stringify([...snapshot.tagIds].sort()));
}

export function revertible(a: Pick<AgentAction, "action" | "entityType" | "entityId" | "approvalStatus" | "revertedByActionId" | "before" | "after">): Revertible {
  if (a.revertedByActionId) return { ok: false, why: "already rolled back" };
  if (a.approvalStatus) return { ok: false, why: "a proposal: approve or reject it instead" };
  if (!a.entityId) return { ok: false, why: "no entity" };
  if (a.entityType === "event" && a.action === "update" && a.before && a.after) return { ok: true, label: "Restore the event as it was" };
  if (a.entityType === "event" && a.action === "insert") return { ok: true, label: "Hide this event" };
  if (a.entityType === "event" && a.action === "merge" && a.before) return { ok: true, label: "Unmerge" };
  if (a.entityType === "source" && ["enable", "disable", "update"].includes(a.action) && a.before && a.after) return { ok: true, label: "Restore the source's state" };
  return { ok: false, why: `rolling back ${a.entityType} ${a.action} isn't supported here` };
}

async function tagsOf(db: DbExecutor, eventId: string) {
  return (await db.select({ tagId: eventTags.tagId }).from(eventTags).where(eq(eventTags.eventId, eventId))).map((t) => t.tagId).sort();
}

async function setTags(db: DbExecutor, eventId: string, tagIds: string[]) {
  await db.delete(eventTags).where(eq(eventTags.eventId, eventId));
  if (tagIds.length) await db.insert(eventTags).values(tagIds.map((tagId) => ({ eventId, tagId })));
}

export async function rollbackAction(db: DbExecutor, actionId: string, opts: { actor: string; reason: string; now?: Date }) {
  const reason = opts.reason.trim();
  if (reason.length < 5) throw new RollbackError("a reason is required");
  if (!opts.actor.startsWith("human:")) throw new RollbackError("only a person rolls back from the admin page");
  const now = opts.now ?? new Date();

  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(agentActions).where(eq(agentActions.id, actionId)).for("update");
    if (!a) throw new RollbackError("no such action");
    const can = revertible(a);
    if (!can.ok) throw new RollbackError(can.why);
    const id = a.entityId!;
    let logged: AgentAction;

    if (a.entityType === "event" && a.action === "merge") {
      const before = a.before as { survivor: Snapshot & { id: string; sources: (typeof eventSources.$inferSelect)[] }; loser: Snapshot & { id: string; sources: (typeof eventSources.$inferSelect)[] } };
      const after = a.after as { survivor: Snapshot; loser: Snapshot; candidateId?: string | null };
      const [s] = await tx.select().from(events).where(eq(events.id, before.survivor.id));
      const [l] = await tx.select().from(events).where(eq(events.id, before.loser.id));
      if (!s || !l || l.status !== "merged" || l.canonicalEventId !== s.id || !sameEvent(s, await tagsOf(tx, s.id), after.survivor)) {
        throw new RollbackError("the events changed after the merge; undo the later changes first");
      }
      const prior = { survivor: { ...s, tagIds: await tagsOf(tx, s.id) }, loser: { ...l, tagIds: await tagsOf(tx, l.id) } };
      await tx.update(events).set({ ...eventFieldsFrom(before.survivor), updatedAt: now }).where(eq(events.id, s.id));
      await tx.update(events).set({ ...eventFieldsFrom(before.loser), updatedAt: now }).where(eq(events.id, l.id));
      await setTags(tx, s.id, before.survivor.tagIds ?? []);
      await setTags(tx, l.id, before.loser.tagIds ?? []);
      for (const src of before.loser.sources) {
        await tx.update(eventSources).set({ eventId: l.id, isPrimary: src.isPrimary }).where(eq(eventSources.id, src.id));
      }
      if (after.candidateId) await tx.update(dedupCandidates).set({ resolvedAt: now, resolvedBy: `${opts.actor} (unmerged)` }).where(eq(dedupCandidates.id, after.candidateId));
      logged = await recordAction(tx, {
        actor: opts.actor, action: "unmerge", entityType: "event", entityId: s.id, revertsActionId: a.id,
        before: prior, after: { survivor: { ...(await tx.select().from(events).where(eq(events.id, s.id)))[0] }, loser: { ...(await tx.select().from(events).where(eq(events.id, l.id)))[0] } },
        reason: `Unmerged: ${reason}`,
      });
    } else if (a.entityType === "event") {
      const [current] = await tx.select().from(events).where(eq(events.id, id));
      if (!current) throw new RollbackError("the event no longer exists");
      const currentTags = await tagsOf(tx, id);
      const prior = { ...current, tagIds: currentTags };
      if (a.action === "insert") {
        if (current.status === "merged") throw new RollbackError("the event was merged since; unmerge it first");
        const [hidden] = await tx.update(events).set({ status: "hidden", updatedAt: now }).where(eq(events.id, id)).returning();
        logged = await recordAction(tx, { actor: opts.actor, action: "rollback", entityType: "event", entityId: id, revertsActionId: a.id, before: prior, after: { ...hidden, tagIds: currentTags }, reason: `Hidden: ${reason}` });
      } else {
        if (!sameEvent(current, currentTags, a.after as Snapshot)) throw new RollbackError("the event changed after this action; undo the later change first");
        const before = a.before as Snapshot;
        const [restored] = await tx.update(events).set({ ...eventFieldsFrom(before), updatedAt: now }).where(eq(events.id, id)).returning();
        if (before.tagIds) await setTags(tx, id, before.tagIds);
        logged = await recordAction(tx, { actor: opts.actor, action: "rollback", entityType: "event", entityId: id, revertsActionId: a.id, before: prior, after: { ...restored, tagIds: await tagsOf(tx, id) }, reason: `Restored: ${reason}` });
      }
    } else {
      const [current] = await tx.select().from(sources).where(eq(sources.id, id));
      const after = a.after as { enabled: boolean; disabledReason: string | null };
      const before = a.before as { enabled: boolean; disabledReason: (typeof sources.$inferSelect)["disabledReason"] };
      if (!current || current.enabled !== after.enabled || current.disabledReason !== after.disabledReason) {
        throw new RollbackError("the source changed after this action; undo the later change first");
      }
      const [restored] = await tx.update(sources).set({ enabled: before.enabled, disabledReason: before.disabledReason }).where(eq(sources.id, id)).returning();
      logged = await recordAction(tx, { actor: opts.actor, action: "rollback", entityType: "source", entityId: id, revertsActionId: a.id, before: current, after: restored, reason: `Restored: ${reason}` });
    }

    await tx.update(agentActions).set({ revertedByActionId: logged.id }).where(eq(agentActions.id, a.id));
    return logged;
  });
}
