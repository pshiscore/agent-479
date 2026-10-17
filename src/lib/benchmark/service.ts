import { and, asc, desc, eq, sql } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { benchmarkItems, benchmarkWeeks, eventProposals, events, MISS_REASONS, type ProposedEvent, TASK_STATUSES } from "@/lib/db/schema";
import { isoWeekday, parseDate } from "@/lib/time";
import { type Match, matchLine } from "./match";
import { type LineError, parseLines } from "./parse";
import { type Coverage, coverage } from "./report";

/** The benchmark's writes (owner actions, each logged) and reads for /admin/benchmark. */

export class BenchmarkError extends Error {}

type Item = typeof benchmarkItems.$inferSelect;
type Reason = (typeof MISS_REASONS)[number];

const fromMatch = (m: Match) => ({
  result: m.result,
  matchedEventId: m.eventId,
  matchedProposalId: m.proposalId,
  missReason: m.missReason,
  suggestedReason: m.suggestedReason,
  // A "no source" task belongs to a missed item only.
  taskStatus: null,
  note: m.note,
});

/** Adds the owner's typed lines to a week (created if new), matching each one. Lines already in the week are skipped. */
export async function addLines(
  db: DbExecutor,
  input: { weekStart: string; label: string | null; text: string },
  opts: { actor: string; now?: Date },
): Promise<{ weekId: string; added: number; repeated: number; errors: LineError[] }> {
  if (isoWeekday(parseDate(input.weekStart)) !== 1) throw new BenchmarkError("a benchmark week starts on a Monday");
  const label = input.label?.trim() || null;
  const { items, errors } = parseLines(input.text, input.weekStart);
  if (items.length === 0) throw new BenchmarkError(errors.length ? `no lines could be read (${errors.length} with problems)` : "nothing typed");
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    let [week] = await tx
      .select()
      .from(benchmarkWeeks)
      .where(and(eq(benchmarkWeeks.weekStart, input.weekStart), sql`coalesce(${benchmarkWeeks.label}, '') = ${label ?? ""}`));
    if (!week) {
      [week] = await tx.insert(benchmarkWeeks).values({ weekStart: input.weekStart, label, createdBy: opts.actor }).returning();
      await recordAction(tx, { actor: opts.actor, action: "insert", entityType: "benchmark_week", entityId: week.id, after: week, reason: `Benchmark week of ${input.weekStart}${label ? ` (${label})` : ""}` });
    }
    const existing = await tx.select({ name: benchmarkItems.name, eventDate: benchmarkItems.eventDate }).from(benchmarkItems).where(eq(benchmarkItems.weekId, week.id));
    const have = new Set(existing.map((e) => `${e.name.toLowerCase()}|${e.eventDate}`));
    let added = 0;
    for (const line of items) {
      if (have.has(`${line.name.toLowerCase()}|${line.date}`)) continue;
      const m = await matchLine(tx, line);
      const [row] = await tx
        .insert(benchmarkItems)
        .values({ weekId: week.id, name: line.name, eventDate: line.date, matchedAt: now, ...fromMatch(m) })
        .returning();
      await recordAction(tx, { actor: opts.actor, action: "insert", entityType: "benchmark_item", entityId: row.id, after: row, reason: `Benchmark line: ${m.result}${m.title ? ` (${m.title}, ${m.score})` : ""}` });
      added++;
    }
    return { weekId: week.id, added, repeated: items.length - added, errors };
  });
}

async function loadItem(db: DbExecutor, id: string): Promise<Item> {
  const [item] = await db.select().from(benchmarkItems).where(eq(benchmarkItems.id, id)).for("update");
  if (!item) throw new BenchmarkError("no such benchmark item");
  return item;
}

async function save(db: DbExecutor, before: Item, set: Partial<Item>, log: { actor: string; reason: string }) {
  const [after] = await db.update(benchmarkItems).set({ ...set, updatedAt: new Date() }).where(eq(benchmarkItems.id, before.id)).returning();
  await recordAction(db, { actor: log.actor, action: "update", entityType: "benchmark_item", entityId: before.id, before, after, reason: log.reason });
  return after;
}

/** The owner's reason for a miss. "No source" opens a registry task; another reason drops it. */
export async function setMissReason(db: DbExecutor, id: string, reason: Reason, opts: { actor: string; note?: string }) {
  if (!MISS_REASONS.includes(reason)) throw new BenchmarkError("unknown reason");
  return db.transaction(async (tx) => {
    const before = await loadItem(tx, id);
    if (before.result !== "missed") throw new BenchmarkError("only a missed item takes a reason");
    const taskStatus = reason === "no_source" ? (before.taskStatus ?? "open") : null;
    const note = opts.note?.trim() || before.note;
    return save(tx, before, { missReason: reason, taskStatus, note }, { actor: opts.actor, reason: `Miss reason: ${reason}${taskStatus === "open" && !before.taskStatus ? " (registry task opened)" : ""}` });
  });
}

/** The owner says a match is wrong: the item is missed, and re-checks leave it missed. */
export async function markWrongMatch(db: DbExecutor, id: string, opts: { actor: string }) {
  return db.transaction(async (tx) => {
    const before = await loadItem(tx, id);
    if (before.result === "missed") throw new BenchmarkError("nothing matched");
    return save(tx, before, { result: "missed", matchedEventId: null, matchedProposalId: null, matchOverridden: true, missReason: null, suggestedReason: null, taskStatus: null }, { actor: opts.actor, reason: "Owner: wrong match" });
  });
}

export async function setTaskStatus(db: DbExecutor, id: string, status: (typeof TASK_STATUSES)[number], opts: { actor: string }) {
  if (!TASK_STATUSES.includes(status)) throw new BenchmarkError("unknown task status");
  return db.transaction(async (tx) => {
    const before = await loadItem(tx, id);
    if (before.missReason !== "no_source") throw new BenchmarkError("no registry task on this item");
    return save(tx, before, { taskStatus: status }, { actor: opts.actor, reason: `Registry task ${status}` });
  });
}

/**
 * Matches a week's items again, since sources keep fetching after the owner
 * types a week. Items the owner marked wrong stay missed. An owner's reason
 * is kept while the item is still missed.
 */
export async function recheckWeek(db: DbExecutor, weekId: string, opts: { actor: string; now?: Date }): Promise<{ checked: number; changed: number }> {
  const now = opts.now ?? new Date();
  const items = await db.select().from(benchmarkItems).where(and(eq(benchmarkItems.weekId, weekId), eq(benchmarkItems.matchOverridden, false))).orderBy(asc(benchmarkItems.createdAt));
  let changed = 0;
  for (const item of items) {
    const m = await matchLine(db, { name: item.name, date: item.eventDate });
    const next = fromMatch(m);
    const stillMissed = item.result === "missed" && m.result === "missed";
    // The owner's reason (and its task) outlives a re-check unless code now knows better.
    if (stillMissed && item.missReason && !m.missReason) Object.assign(next, { missReason: item.missReason, taskStatus: item.taskStatus, note: item.note });
    const same = next.result === item.result && next.matchedEventId === item.matchedEventId && next.matchedProposalId === item.matchedProposalId && next.missReason === item.missReason && next.suggestedReason === item.suggestedReason;
    if (same) continue;
    await db.transaction(async (tx) => {
      const before = await loadItem(tx, item.id);
      await save(tx, before, { ...next, matchedAt: now }, { actor: opts.actor, reason: `Benchmark re-check: ${item.result} → ${m.result}${m.title ? ` (${m.title}, ${m.score})` : ""}` });
    });
    changed++;
  }
  return { checked: items.length, changed };
}

// ---- Reads ----

export interface WeekSummary {
  id: string;
  weekStart: string;
  label: string | null;
  items: number;
  coverage: Coverage;
}

/** Every week with its coverage, newest first. */
export async function weekSummaries(db: DbExecutor): Promise<WeekSummary[]> {
  const weeks = await db.select().from(benchmarkWeeks).orderBy(desc(benchmarkWeeks.weekStart), asc(benchmarkWeeks.createdAt));
  const rows = await db.select({ weekId: benchmarkItems.weekId, result: benchmarkItems.result, missReason: benchmarkItems.missReason }).from(benchmarkItems);
  return weeks.map((w) => {
    const mine = rows.filter((r) => r.weekId === w.id);
    return { id: w.id, weekStart: w.weekStart, label: w.label, items: mine.length, coverage: coverage(mine) };
  });
}

export interface ItemView extends Item {
  eventTitle: string | null;
  eventSlug: string | null;
  proposalTitle: string | null;
}

export async function weekItems(db: DbExecutor, weekId: string): Promise<ItemView[]> {
  const rows = await db
    .select({ item: benchmarkItems, eventTitle: events.title, eventSlug: events.slug, proposalFacts: eventProposals.facts })
    .from(benchmarkItems)
    .leftJoin(events, eq(events.id, benchmarkItems.matchedEventId))
    .leftJoin(eventProposals, eq(eventProposals.id, benchmarkItems.matchedProposalId))
    .where(eq(benchmarkItems.weekId, weekId))
    .orderBy(asc(benchmarkItems.eventDate), asc(benchmarkItems.name));
  return rows.map((r) => ({ ...r.item, eventTitle: r.eventTitle, eventSlug: r.eventSlug, proposalTitle: (r.proposalFacts as ProposedEvent | null)?.title ?? null }));
}

/** Open registry tasks from "no source" misses, oldest first. */
export async function openTasks(db: DbExecutor) {
  return db
    .select({ id: benchmarkItems.id, name: benchmarkItems.name, eventDate: benchmarkItems.eventDate, note: benchmarkItems.note, weekId: benchmarkItems.weekId })
    .from(benchmarkItems)
    .where(eq(benchmarkItems.taskStatus, "open"))
    .orderBy(asc(benchmarkItems.createdAt));
}
