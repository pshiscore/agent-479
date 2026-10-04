import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { agentActor } from "@/lib/actions/record";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, categories, eventSeries, eventSources, events, sources, venues } from "@/lib/db/schema";
import { detectSeries } from "@/lib/pipeline/series";
import { chicagoToUtc } from "@/lib/time";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const NOW = new Date("2026-10-04T15:00:00Z");
const ACTOR = agentActor("process");
const tag = randomUUID().slice(0, 8);

async function setup(tx: DbTx) {
  const [src] = await tx
    .insert(sources)
    .values({ slug: `series-${tag}`, name: "S", kind: "ics", fetcher: "ics", baseUrl: "https://x.example/", trustLevel: 3, fetchIntervalMinutes: 60, termsNotes: "t" })
    .returning();
  const [venue] = await tx.select().from(venues).where(eq(venues.slug, "fayetteville-public-library"));
  const [cat] = await tx.select().from(categories).where(eq(categories.slug, "talks-learning"));
  let n = 0;
  const add = async (title: string, date: string, time = "18:00") => {
    const [y, m, d] = date.split("-").map(Number);
    const [h, min] = time.split(":").map(Number);
    const [ev] = await tx
      .insert(events)
      .values({
        slug: `s-${tag}-${++n}`, title, normalizedTitle: title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
        startAt: chicagoToUtc({ year: y, month: m, day: d }, { hour: h, minute: min }), venueId: venue.id, categoryId: cat.id,
      })
      .returning();
    await tx.insert(eventSources).values({ eventId: ev.id, sourceId: src.id, externalId: `x-${n}`, isPrimary: true });
    return ev;
  };
  return { src, add };
}

describe("detectSeries", () => {
  it("creates a recurring series and a run, attaches their events, and logs each change", async () => {
    await inRollback(async (tx) => {
      const { src, add } = await setup(tx);
      const weekly = [await add("Chess Club", "2026-10-06"), await add("Chess Club", "2026-10-13"), await add("Chess Club", "2026-10-20")];
      const oneOff = await add("Chess Club", "2026-10-24", "14:00");
      const run = [await add("A Christmas Carol", "2026-12-10", "19:30"), await add("A Christmas Carol", "2026-12-11", "19:30"), await add("A Christmas Carol", "2026-12-12", "19:30")];
      const single = await add("Author Talk", "2026-10-15");

      const stats = await detectSeries(tx, { now: NOW, actor: ACTOR, sourceId: src.id });
      expect(stats).toMatchObject({ groups: 3, seriesCreated: 2, eventsAttached: 6, eventsDetached: 0 });

      const all = await tx.select().from(eventSeries).where(eq(eventSeries.sourceId, src.id));
      const chess = all.find((s) => s.normalizedTitle === "chess club")!;
      const carol = all.find((s) => s.normalizedTitle === "a christmas carol")!;
      expect(chess).toMatchObject({ kind: "recurring", recurrenceLabel: "Tuesdays", detectedBy: "pattern", active: true, slug: "chess-club" });
      expect(carol).toMatchObject({ kind: "run", recurrenceLabel: "Dec 10–12" });

      const rows = await tx.select({ id: events.id, seriesId: events.seriesId }).from(events).where(inArray(events.id, [...weekly, oneOff, ...run, single].map((e) => e.id)));
      const seriesOf = new Map(rows.map((r) => [r.id, r.seriesId]));
      for (const e of weekly) expect(seriesOf.get(e.id)).toBe(chess.id);
      for (const e of run) expect(seriesOf.get(e.id)).toBe(carol.id);
      expect(seriesOf.get(oneOff.id)).toBeNull();
      expect(seriesOf.get(single.id)).toBeNull();

      const logs = await tx.select().from(agentActions).where(and(eq(agentActions.entityType, "event"), eq(agentActions.entityId, weekly[0].id)));
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ action: "update", actor: "agent:process" });
      expect((logs[0].before as { seriesId: string | null }).seriesId).toBeNull();
      expect((logs[0].after as { seriesId: string }).seriesId).toBe(chess.id);
      const [created] = await tx.select().from(agentActions).where(and(eq(agentActions.entityType, "event_series"), eq(agentActions.entityId, chess.id)));
      expect(created.action).toBe("insert");

      // Idempotent: a second run writes nothing.
      expect(await detectSeries(tx, { now: NOW, actor: ACTOR, sourceId: src.id })).toMatchObject({ seriesCreated: 0, seriesUpdated: 0, eventsAttached: 0, eventsDetached: 0 });
    });
  });

  it("retires a series that stops qualifying and detaches its upcoming events, logged", async () => {
    await inRollback(async (tx) => {
      const { src, add } = await setup(tx);
      const weekly = [await add("Knitting Circle", "2026-10-06"), await add("Knitting Circle", "2026-10-13"), await add("Knitting Circle", "2026-10-20")];
      await detectSeries(tx, { now: NOW, actor: ACTOR, sourceId: src.id });
      await tx.update(events).set({ status: "cancelled" }).where(eq(events.id, weekly[2].id));

      const stats = await detectSeries(tx, { now: NOW, actor: ACTOR, sourceId: src.id });
      expect(stats).toMatchObject({ seriesRetired: 1, eventsDetached: 2 });
      const [s] = await tx.select().from(eventSeries).where(eq(eventSeries.sourceId, src.id));
      expect(s.active).toBe(false);
      const rows = await tx.select({ seriesId: events.seriesId }).from(events).where(inArray(events.id, weekly.slice(0, 2).map((e) => e.id)));
      expect(rows.every((r) => r.seriesId === null)).toBe(true);
      const [retired] = await tx.select().from(agentActions).where(and(eq(agentActions.entityType, "event_series"), eq(agentActions.action, "update"), eq(agentActions.entityId, s.id)));
      expect(retired.reason).toMatch(/no longer qualifies/);

      // It comes back when the program does, reusing the same row.
      await add("Knitting Circle", "2026-10-27");
      expect(await detectSeries(tx, { now: NOW, actor: ACTOR, sourceId: src.id })).toMatchObject({ seriesCreated: 0, seriesUpdated: 1, eventsAttached: 3 });
    });
  });
});
