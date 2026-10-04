import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { agentActor } from "@/lib/actions/record";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, categories, dedupCandidates, eventSeries, eventSources, events, llmCalls, rawRecords, sources, venues } from "@/lib/db/schema";
import type { GenerateRequest } from "@/lib/llm";
import { runDedup } from "@/lib/pipeline/dedup";
import type { Generate } from "@/lib/pipeline/enrich/types";
import { writeEvent } from "@/lib/pipeline/write-event";
import { startRun } from "@/lib/runs";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const NOW = new Date("2027-08-04T15:00:00Z");
const ACTOR = agentActor("process");
const tag = randomUUID().slice(0, 8);

function fakeTiebreak(tx: DbTx, answer: { same: boolean; confidence: number }) {
  return vi.fn(async (req: GenerateRequest<z.ZodType>) => {
    const [call] = await tx.insert(llmCalls).values({ task: req.task, provider: "fake", model: "fake-model", status: "ok", promptVersion: req.promptVersion }).returning({ id: llmCalls.id });
    return { data: req.schema.parse(answer), callId: call.id, model: "fake-model", costUsd: 0 };
  }) as unknown as Generate;
}

async function setup(tx: DbTx, mode: "shadow" | "live") {
  const mk = async (name: string, trust: number) =>
    (
      await tx
        .insert(sources)
        .values({ slug: `dd-${tag}-${randomUUID().slice(0, 4)}`, name, kind: "ics", fetcher: "ics", baseUrl: "https://x.example/", trustLevel: trust, fetchIntervalMinutes: 60, termsNotes: "t", dedupMode: mode })
        .returning()
    )[0];
  const hi = await mk("City", 5);
  const lo = await mk("Aggregator", 3);
  const [venue] = await tx.select().from(venues).where(eq(venues.slug, "rogers-historical-museum"));
  const [cat] = await tx.select().from(categories).where(eq(categories.slug, "talks-learning"));
  let n = 0;
  const add = async (src: typeof hi, title: string, iso: string, over: Partial<typeof events.$inferInsert> = {}) => {
    const [ev] = await tx
      .insert(events)
      .values({ slug: `dd-${tag}-${++n}`, title, normalizedTitle: title.toLowerCase(), startAt: new Date(iso), venueId: venue.id, categoryId: cat.id, ...over })
      .returning();
    await tx.insert(eventSources).values({ eventId: ev.id, sourceId: src.id, externalId: `x-${tag}-${n}`, isPrimary: true });
    return ev;
  };
  return { hi, lo, add, cat, venue };
}

describe("runDedup", () => {
  it("in shadow mode records every decision, logged, and merges nothing", async () => {
    await inRollback(async (tx) => {
      const { hi, lo, add } = await setup(tx, "shadow");
      const a = await add(hi, "Ziggy Marley", "2027-08-17T01:00:00Z");
      const b = await add(lo, "Ziggy Marley - One Love Tour", "2027-08-17T01:15:00Z");
      const c = await add(lo, "Toddler Time", "2027-08-17T00:00:00Z");
      const generate = fakeTiebreak(tx, { same: false, confidence: 0.9 });

      const stats = await runDedup(tx, { now: NOW, actor: ACTOR, generate, sourceId: lo.id });
      expect(stats).toMatchObject({ pairs: 3, auto_merge: 1, distinct: 2, merged: 0 });
      const cands = await tx.select().from(dedupCandidates).where(inArray(dedupCandidates.eventAId, [a.id, b.id, c.id]));
      const zig = cands.find((x) => [x.eventAId, x.eventBId].sort().join() === [a.id, b.id].sort().join())!;
      expect(zig).toMatchObject({ decision: "auto_merge", mode: "shadow", resolvedAt: null });
      expect(zig.eventAId < zig.eventBId).toBe(true);
      const rows = await tx.select().from(events).where(inArray(events.id, [a.id, b.id]));
      expect(rows.every((r) => r.status === "scheduled")).toBe(true);
      const [log] = await tx.select().from(agentActions).where(and(eq(agentActions.entityType, "dedup_candidate"), eq(agentActions.entityId, zig.id)));
      expect(log.reason).toMatch(/^auto_merge \(shadow\)/);
      // Decided pairs aren't looked at again.
      expect((await runDedup(tx, { now: NOW, actor: ACTOR, generate, sourceId: lo.id })).pairs).toBe(0);
    });
  });

  it("asks the tiebreak in the middle band: a hesitant 'same' is uncertain", async () => {
    await inRollback(async (tx) => {
      const { hi, lo, add } = await setup(tx, "shadow");
      // One shared word of two: the middle band (token-set 0.67).
      await add(hi, "Harvest Market", "2027-08-17T15:00:00Z");
      await add(lo, "Harvest Dance", "2027-08-17T15:00:00Z");
      const generate = fakeTiebreak(tx, { same: true, confidence: 0.6 });
      const stats = await runDedup(tx, { now: NOW, actor: ACTOR, generate, sourceId: lo.id });
      expect(stats).toMatchObject({ uncertain: 1, llmCalls: 1 });
      expect(generate).toHaveBeenCalledWith(expect.objectContaining({ task: "dedup_tiebreak", promptVersion: "dedup@1" }));
      const req = (generate as unknown as { mock: { calls: [GenerateRequest<z.ZodType>][] } }).mock.calls[0][0];
      expect(req.input).toMatch(/<<<UNTRUSTED-/);
      // Over the call limit, pairs wait for the next run instead of being decided.
      await add(hi, "Pumpkin Patch", "2027-08-18T15:00:00Z");
      await add(lo, "Pumpkin Carving", "2027-08-18T15:00:00Z");
      expect(await runDedup(tx, { now: NOW, actor: ACTOR, generate, sourceId: lo.id, llmLimit: 0 })).toMatchObject({ deferred: 1, pairs: 0 });
    });
  });

  it("calls two occurrences of one series at different times distinct, without the model", async () => {
    await inRollback(async (tx) => {
      const { hi, add, cat, venue } = await setup(tx, "shadow");
      const [s] = await tx
        .insert(eventSeries)
        .values({ slug: `dd-series-${tag}`, title: "Ghost Walks", normalizedTitle: "ghost walks", sourceId: hi.id, venueId: venue.id, categoryId: cat.id, kind: "recurring", recurrenceLabel: "Thursdays", detectedBy: "pattern" })
        .returning();
      await add(hi, "Ghost Walks", "2027-08-30T00:00:00Z", { seriesId: s.id });
      await add(hi, "Ghost Walks", "2027-08-30T01:00:00Z", { seriesId: s.id });
      const generate = fakeTiebreak(tx, { same: true, confidence: 1 });
      expect(await runDedup(tx, { now: NOW, actor: ACTOR, generate, sourceId: hi.id })).toMatchObject({ distinct: 1, series_siblings: 1, llmCalls: 0 });
    });
  });

  it("in live mode merges into the more trusted source's event, logging the full before-state", async () => {
    await inRollback(async (tx) => {
      const { hi, lo, add } = await setup(tx, "live");
      const loser = await add(lo, "Ziggy Marley - One Love Tour", "2027-08-17T01:15:00Z", { endAt: new Date("2027-08-17T04:00:00Z"), ticketUrl: "https://www.ticketmaster.com/x/event/Z1" });
      const survivor = await add(hi, "Ziggy Marley", "2027-08-17T01:00:00Z");
      const stats = await runDedup(tx, { now: NOW, actor: ACTOR, generate: fakeTiebreak(tx, { same: false, confidence: 1 }), sourceId: lo.id });
      expect(stats).toMatchObject({ auto_merge: 1, merged: 1 });

      const [s] = await tx.select().from(events).where(eq(events.id, survivor.id));
      const [l] = await tx.select().from(events).where(eq(events.id, loser.id));
      expect(s).toMatchObject({ status: "scheduled", endAt: new Date("2027-08-17T04:00:00Z"), ticketUrl: "https://www.ticketmaster.com/x/event/Z1" });
      expect(l).toMatchObject({ status: "merged", canonicalEventId: survivor.id });
      const srcRows = await tx.select().from(eventSources).where(eq(eventSources.eventId, survivor.id));
      expect(srcRows).toHaveLength(2);
      expect(srcRows.filter((r) => r.isPrimary)).toHaveLength(1);

      const [m] = await tx.select().from(agentActions).where(and(eq(agentActions.action, "merge"), eq(agentActions.entityId, survivor.id)));
      const before = m.before as { loser: { status: string; sources: unknown[] }; survivor: { endAt: string | null } };
      expect(before.loser.status).toBe("scheduled");
      expect(before.loser.sources).toHaveLength(1);
      expect(before.survivor.endAt).toBeNull();
      const [cand] = await tx.select().from(dedupCandidates).where(eq(dedupCandidates.eventBId, [loser.id, survivor.id].sort()[1]));
      expect(cand).toMatchObject({ mode: "live", resolvedBy: ACTOR });
    });
  });

  it("re-enriching a merged-away record never revives it or overwrites the survivor", async () => {
    await inRollback(async (tx) => {
      const { hi, lo, add, cat, venue } = await setup(tx, "live");
      const loser = await add(lo, "Ziggy Marley - One Love Tour", "2027-08-17T01:15:00Z");
      const survivor = await add(hi, "Ziggy Marley", "2027-08-17T01:00:00Z");
      const run = await startRun(tx, "process");
      const [srcRow] = await tx.select().from(eventSources).where(eq(eventSources.eventId, loser.id));
      const [rec] = await tx
        .insert(rawRecords)
        .values({ sourceId: lo.id, runId: run.id, externalId: srcRow.externalId, contentHash: "h", payload: {}, status: "extracted", facts: {}, eventId: loser.id, venueId: venue.id })
        .returning();
      await runDedup(tx, { now: NOW, actor: ACTOR, generate: fakeTiebreak(tx, { same: false, confidence: 1 }), sourceId: lo.id });

      const facts = {
        title: "ZIGGY MARLEY (rewritten)", startAt: "2027-08-17T01:15:00.000Z", endAt: null, allDay: false, timeTba: false, status: "scheduled" as const,
        sourceUrl: "https://x.example/e/1", ticketUrl: null,
        location: { text: null, name: null, room: null, street: null, city: null, externalVenueId: null },
        price: { min: null, max: null, currency: null }, performers: [], sourceCategories: [], legalAgeEnforced: null, recurrence: null, timezoneAssumed: false,
      };
      const r = await writeEvent(tx, rec, {
        facts, venueId: venue.id, subSpace: null, categoryId: cat.id, tagIds: [], isFree: null, freeBasis: null,
        ageMin: null, ageMax: null, gradeMin: null, gradeMax: null, registrationRequired: null, priceMin: null, priceMax: null, shortDescription: null,
      }, { actor: ACTOR, runId: run.id, model: null, llmCallId: null, reason: "re-enrich", meta: {} });
      expect(r.created).toBe(false);
      const [l] = await tx.select().from(events).where(eq(events.id, loser.id));
      const [s] = await tx.select().from(events).where(eq(events.id, survivor.id));
      expect(l.status).toBe("merged");
      expect(s.title).toBe("Ziggy Marley");
      const [moved] = await tx.select().from(eventSources).where(eq(eventSources.externalId, srcRow.externalId));
      expect(moved.eventId).toBe(survivor.id);
    });
  });
});
