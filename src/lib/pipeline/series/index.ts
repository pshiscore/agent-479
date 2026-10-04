import { and, eq, gte, like, sql } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { eventSeries, eventSources, events, rawRecords } from "@/lib/db/schema";
import { slugify } from "@/lib/slug";
import { type Occurrence, planSeries, rruleLabel, type SeriesKind } from "./detect";

/**
 * Applies series detection to the upcoming events (build step 14). Groups
 * scheduled events by source, venue, and normalized title; an ICS RRULE makes
 * its group a series directly, otherwise planSeries decides. Creates or
 * updates event_series rows and sets events.series_id, logging every change
 * row by row (AGENTS.md rule 2). A group that stops qualifying keeps its row,
 * marked inactive, and its upcoming events are detached. Past events keep the
 * series they had. Idempotent: a second run with nothing new writes nothing.
 */

// Events that started up to a day ago still count, so a series doesn't flicker
// on the day of an occurrence.
const LOOKBACK_MS = 24 * 60 * 60_000;

type SeriesRow = typeof eventSeries.$inferSelect;
type Desired = Pick<SeriesRow, "title" | "categoryId" | "kind" | "recurrenceLabel" | "rrule" | "detectedBy" | "active">;
const COMPARED = ["title", "categoryId", "kind", "recurrenceLabel", "rrule", "detectedBy", "active"] as const;

interface Row {
  id: string;
  title: string;
  normalizedTitle: string;
  venueId: string;
  categoryId: string;
  startAt: Date;
  allDay: boolean;
  timeTba: boolean;
  seriesId: string | null;
  sourceId: string;
  rrule: string | null;
}

/** The most common value; ties go to the earliest occurrence. */
function mode<T>(values: T[]): T {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
}

async function uniqueSeriesSlug(db: DbExecutor, title: string): Promise<string> {
  const base = slugify(title) || "series";
  const taken = new Set((await db.select({ slug: eventSeries.slug }).from(eventSeries).where(like(eventSeries.slug, `${base}%`))).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export async function detectSeries(
  db: DbExecutor,
  // sourceId limits detection to one source (tests and one-off runs).
  opts: { now: Date; actor: string; runId?: string | null; sourceId?: string },
) {
  const job = opts.actor.replace(/^agent:/, "");
  const rows: Row[] = await db
    .select({
      id: events.id,
      title: events.title,
      normalizedTitle: events.normalizedTitle,
      venueId: events.venueId,
      categoryId: events.categoryId,
      startAt: events.startAt,
      allDay: events.allDay,
      timeTba: events.timeTba,
      seriesId: events.seriesId,
      sourceId: eventSources.sourceId,
      rrule: sql<string | null>`${rawRecords.facts}->'recurrence'->>'rrule'`,
    })
    .from(events)
    .innerJoin(eventSources, and(eq(eventSources.eventId, events.id), eq(eventSources.isPrimary, true)))
    .leftJoin(rawRecords, eq(rawRecords.id, eventSources.rawRecordId))
    .where(
      and(
        eq(events.status, "scheduled"),
        gte(events.startAt, new Date(opts.now.getTime() - LOOKBACK_MS)),
        opts.sourceId ? eq(eventSources.sourceId, opts.sourceId) : undefined,
      ),
    );

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.sourceId}|${r.venueId}|${r.normalizedTitle}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const existing = new Map(
    (await db.select().from(eventSeries)).map((s): [string, SeriesRow] => [`${s.sourceId}|${s.venueId}|${s.normalizedTitle}`, s]),
  );

  const stats = { groups: groups.size, seriesCreated: 0, seriesUpdated: 0, seriesRetired: 0, eventsAttached: 0, eventsDetached: 0 };

  for (const [key, list] of groups) {
    const rrule = list.find((r) => r.rrule)?.rrule ?? null;
    const plan: { kind: SeriesKind; label: string; members: string[] } | null = rrule
      ? { kind: "recurring", label: rruleLabel(rrule) ?? "Recurring", members: list.map((r) => r.id) }
      : planSeries(list.map((r): Occurrence => ({ eventId: r.id, startAt: r.startAt, allDay: r.allDay, timeTba: r.timeTba })));
    let series = existing.get(key) ?? null;

    if (plan) {
      const members = list.filter((r) => plan.members.includes(r.id));
      const desired: Desired = {
        title: mode(members.map((r) => r.title)),
        categoryId: mode(members.map((r) => r.categoryId)),
        kind: plan.kind,
        recurrenceLabel: plan.label,
        rrule,
        detectedBy: rrule ? "rrule" : "pattern",
        active: true,
      };
      const reason = `${plan.kind === "run" ? "Run" : "Recurring series"} "${desired.title}" (${plan.label}): ${members.length} upcoming occurrences${rrule ? ", from the feed's RRULE" : ""}`;
      if (!series) {
        const [created] = await db
          .insert(eventSeries)
          .values({ ...desired, slug: await uniqueSeriesSlug(db, desired.title), normalizedTitle: list[0].normalizedTitle, sourceId: list[0].sourceId, venueId: list[0].venueId })
          .returning();
        await recordAction(db, { runId: opts.runId, actor: opts.actor, job, action: "insert", entityType: "event_series", entityId: created.id, after: created, reason });
        series = created;
        stats.seriesCreated++;
      } else if (COMPARED.some((k) => series![k] !== desired[k])) {
        const [after] = await db.update(eventSeries).set({ ...desired, updatedAt: opts.now }).where(eq(eventSeries.id, series.id)).returning();
        await recordAction(db, { runId: opts.runId, actor: opts.actor, job, action: "update", entityType: "event_series", entityId: series.id, before: series, after, reason });
        series = after;
        stats.seriesUpdated++;
      }
    } else if (series?.active) {
      const [after] = await db.update(eventSeries).set({ active: false, updatedAt: opts.now }).where(eq(eventSeries.id, series.id)).returning();
      await recordAction(db, {
        runId: opts.runId, actor: opts.actor, job, action: "update", entityType: "event_series", entityId: series.id, before: series, after,
        reason: `Series "${series.title}" no longer qualifies (${list.length} upcoming occurrence${list.length === 1 ? "" : "s"}); marked inactive`,
      });
      stats.seriesRetired++;
    }

    // Point each upcoming event at its series, or at none.
    for (const r of list) {
      const want = plan && series && plan.members.includes(r.id) ? series.id : null;
      if (r.seriesId === want) continue;
      const [before] = await db.select().from(events).where(eq(events.id, r.id));
      const [after] = await db.update(events).set({ seriesId: want, updatedAt: opts.now }).where(eq(events.id, r.id)).returning();
      await recordAction(db, {
        runId: opts.runId, actor: opts.actor, job, action: "update", entityType: "event", entityId: r.id, before, after,
        reason: want ? `Joined series "${series!.title}" (${series!.recurrenceLabel})` : "Left its series: no longer matches the pattern",
      });
      if (want) stats.eventsAttached++;
      else stats.eventsDetached++;
    }
  }
  return stats;
}
