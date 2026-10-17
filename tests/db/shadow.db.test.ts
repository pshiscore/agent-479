import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { humanActor } from "@/lib/actions/record";
import { loadActiveTaxonomy } from "@/lib/categories";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, eventProposals, eventSources, events, llmCalls, rawRecords, sources, venues } from "@/lib/db/schema";
import type { GenerateRequest } from "@/lib/llm";
import { enrichRecord } from "@/lib/pipeline/enrich";
import type { Generate } from "@/lib/pipeline/enrich/types";
import { exclusionReason } from "@/lib/pipeline/exclude";
import { dueSources } from "@/lib/pipeline/fetch";
import { mapRecord } from "@/lib/pipeline/map";
import { addSourceFilter, bulkDecide, filterSkipsThisWeek, previewFilter, removeSourceFilter, sourceStats } from "@/lib/review/by-source";
import { hideRemovedShadowEvents } from "@/lib/review/shadow";
import { approveProposal, pendingProposals, rejectProposal } from "@/lib/review/proposals";
import { startRun } from "@/lib/runs";
import { setPublishState } from "@/lib/sources/admin";
import { demoteLiveSources } from "@/lib/sources/demotion";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const OWNER = humanActor("owner");

function fakeModel(tx: DbTx, category = "family-kids") {
  return vi.fn(async (req: GenerateRequest<z.ZodType>) => {
    const out: Record<string, unknown> = {
      extract: { isFree: true, priceMin: null, priceMax: null, ageRestriction: "all_ages", familyFriendly: true, registrationRequired: false, ageMin: null, ageMax: null, gradeMin: null, gradeMax: null, spanish: false, activity: null },
      classify: { category, tags: [], closestMissingCategory: null },
      describe: { description: null, usedFacts: [] },
    };
    const [call] = await tx.insert(llmCalls).values({ task: req.task, provider: "fake", model: "fake-model", status: "ok", promptVersion: req.promptVersion }).returning({ id: llmCalls.id });
    return { data: req.schema.parse(out[req.task]), callId: call.id, model: "fake-model", costUsd: 0 };
  }) as unknown as Generate;
}

/** A mapped record from the Fayetteville library source, which these tests put in shadow. */
async function shadowRecord(tx: DbTx, title: string, start = "20271013T143000Z", externalId = `shadow-${randomUUID()}`, opts: { state?: "shadow" | "live"; venueId?: string } = {}) {
  const [lib] = await tx.select().from(sources).where(eq(sources.slug, "library-fayetteville"));
  await tx.update(sources).set({ publishState: opts.state ?? "shadow" }).where(eq(sources.id, lib.id));
  const [venue] = opts.venueId ? await tx.select().from(venues).where(eq(venues.id, opts.venueId)) : await tx.select().from(venues).where(eq(venues.slug, "fayetteville-public-library"));
  const run = await startRun(tx, "fetch", { sourceId: lib.id });
  const payload = {
    format: "ics",
    feed: { url: "https://faylib.org/feeds", defaultTimezone: null, timezones: [] },
    event: { uid: externalId, recurrenceId: null, summary: title, dtstart: { value: start, isDate: false }, dtend: null, duration: "PT30M", rrule: null, rdate: [], exdate: [], location: "Fayetteville Public Library", geo: null, url: null, status: "CONFIRMED", categories: [], sequence: null, lastModified: null },
  };
  const facts = mapRecord(payload, lib);
  const [rec] = await tx
    .insert(rawRecords)
    .values({ sourceId: lib.id, runId: run.id, externalId, contentHash: "h", payload, descriptionText: "A program at the library.", status: "mapped", facts, venueId: venue.id, venueMatchedBy: "default_venue" })
    .returning();
  return { lib, rec, run };
}

describe("shadow mode", () => {
  it("a shadow source's event becomes one review item, not an event; refetches update it; approval publishes it with its source link", async () => {
    await inRollback(async (tx) => {
      const { lib, rec, run } = await shadowRecord(tx, "Lego Club Shadow Test");
      const taxonomy = await loadActiveTaxonomy(tx);
      const r = await enrichRecord(tx, rec, { generate: fakeModel(tx), taxonomy, runId: run.id });
      expect(r).toMatchObject({ event: null, shadow: "created" });
      expect(await tx.select().from(eventSources).where(and(eq(eventSources.sourceId, lib.id), eq(eventSources.externalId, rec.externalId)))).toHaveLength(0);
      const [item] = await tx.select().from(eventProposals).where(and(eq(eventProposals.sourceId, lib.id), eq(eventProposals.externalId, rec.externalId)));
      expect(item).toMatchObject({ origin: "shadow", status: "pending", reasons: ["shadow_source"], flags: [] });
      expect(item.facts.title).toBe("Lego Club Shadow Test");

      // Same record again: no second item, nothing new logged.
      const again = await enrichRecord(tx, rec, { generate: fakeModel(tx), taxonomy, runId: run.id });
      expect(again.shadow).toBe("unchanged");
      expect(await tx.select().from(eventProposals).where(eq(eventProposals.externalId, rec.externalId))).toHaveLength(1);

      // Unflagged shadow items are reviewed by source, not in the one-by-one list.
      expect((await pendingProposals(tx)).map((p) => p.id)).not.toContain(item.id);

      const { event } = await approveProposal(tx, item.id, { actor: OWNER, note: "looks right" });
      expect(event).toMatchObject({ title: "Lego Club Shadow Test", status: "scheduled" });
      const [link] = await tx.select().from(eventSources).where(eq(eventSources.eventId, event.id));
      expect(link).toMatchObject({ sourceId: lib.id, externalId: rec.externalId, isPrimary: true });
      const [log] = await tx.select().from(agentActions).where(and(eq(agentActions.entityId, event.id), eq(agentActions.action, "insert")));
      expect(log).toMatchObject({ actor: OWNER });
      expect(log.reason).toMatch(/^Owner confirmed a shadow event from library-fayetteville/);

      // The record now belongs to a published event, so the next run updates that event.
      const [rec2] = await tx.select().from(rawRecords).where(eq(rawRecords.id, rec.id));
      const later = await enrichRecord(tx, { ...rec2, status: "mapped" }, { generate: fakeModel(tx), taxonomy, runId: run.id });
      expect(later).toMatchObject({ shadow: null, created: false });
      expect(later.event!.id).toBe(event.id);
    });
  });

  it("a rejected item stays rejected on refetch, with its kind; flagged items aren't bulk-approved; filters reject now and skip later", async () => {
    await inRollback(async (tx) => {
      const taxonomy = await loadActiveTaxonomy(tx);
      const a = await shadowRecord(tx, "Adult League Volleyball Night", "20271014T230000Z");
      await enrichRecord(tx, a.rec, { generate: fakeModel(tx), taxonomy, runId: a.run.id });
      const [itemA] = await tx.select().from(eventProposals).where(eq(eventProposals.externalId, a.rec.externalId));
      await rejectProposal(tx, itemA.id, { actor: OWNER, reason: "not public", kind: "not_public" });
      expect((await enrichRecord(tx, a.rec, { generate: fakeModel(tx), taxonomy, runId: a.run.id })).shadow).toBe("decided");
      const [stillA] = await tx.select().from(eventProposals).where(eq(eventProposals.id, itemA.id));
      expect(stillA).toMatchObject({ status: "rejected", rejectKind: "not_public" });

      // A Community pick is flagged: one-by-one review, never bulk-approved.
      const b = await shadowRecord(tx, "Book Club Shadow Meetup", "20271015T230000Z");
      await enrichRecord(tx, b.rec, { generate: fakeModel(tx, "community"), taxonomy, runId: b.run.id });
      const [itemB] = await tx.select().from(eventProposals).where(eq(eventProposals.externalId, b.rec.externalId));
      expect(itemB.flags).toEqual(["community_fallback"]);
      expect((await pendingProposals(tx)).map((p) => p.id)).toContain(itemB.id);
      expect(await bulkDecide(tx, b.lib.id, "book club", "approve", { actor: OWNER, note: "" })).toMatchObject({ done: 0, skippedFlagged: 1 });

      // A filter: pending matches are rejected as filtered now, and future records are skipped.
      const c = await shadowRecord(tx, "Adult League Soccer", "20271016T230000Z");
      await enrichRecord(tx, c.rec, { generate: fakeModel(tx), taxonomy, runId: c.run.id });
      const r = await addSourceFilter(tx, c.lib.id, "adult league", { actor: OWNER });
      expect(r.rejected).toBe(1);
      const [itemC] = await tx.select().from(eventProposals).where(eq(eventProposals.externalId, c.rec.externalId));
      expect(itemC).toMatchObject({ status: "rejected", rejectKind: "filtered" });
      const [libAfter] = await tx.select().from(sources).where(eq(sources.id, c.lib.id));
      expect(exclusionReason({ ...c.rec.facts!, title: "Adult League Kickball" } as never, new Date("2027-10-01T00:00:00Z"), libAfter.config)).toMatch(/^filter:/);
      const stats = await sourceStats(tx, c.lib.id);
      expect(stats.rejectedByKind).toMatchObject({ filtered: 1, not_public: 1 });
    });
  });

  it("publish states: logged moves, owner-only promotion, paused and proposed sources aren't fetched, agent demotes a failing live source", async () => {
    await inRollback(async (tx) => {
      const [lib] = await tx.select().from(sources).where(eq(sources.slug, "library-fayetteville"));
      await tx.update(sources).set({ enabled: true, publishState: "shadow", lastFetchedAt: null }).where(eq(sources.id, lib.id));
      await expect(setPublishState(tx, lib.slug, "live", "agent wants it", "agent:x")).rejects.toThrow(/only the owner/);
      await setPublishState(tx, lib.slug, "paused", "taking a break", OWNER);
      expect((await dueSources(tx, new Date())).map((s) => s.slug)).not.toContain(lib.slug);
      await setPublishState(tx, lib.slug, "live", "resume as live", OWNER);
      expect((await dueSources(tx, new Date())).map((s) => s.slug)).toContain(lib.slug);
      await expect(setPublishState(tx, lib.slug, "proposed", "back to start", OWNER)).rejects.toThrow(/can't go from live to proposed/);

      await tx.update(sources).set({ consecutiveFailures: 3 }).where(eq(sources.id, lib.id));
      const demoted = await demoteLiveSources(tx, new Date(), "agent:maintenance");
      expect(demoted.map((d) => d.slug)).toContain(lib.slug);
      const [after] = await tx.select().from(sources).where(eq(sources.id, lib.id));
      expect(after.publishState).toBe("shadow");
      const logs = await tx.select().from(agentActions).where(and(eq(agentActions.entityId, lib.id), eq(agentActions.entityType, "source")));
      expect(logs.map((l) => l.reason)).toEqual(expect.arrayContaining([expect.stringMatching(/^shadow → paused/), expect.stringMatching(/^paused → live/), expect.stringMatching(/^live → shadow: Demoted automatically: its feed failed 3 runs/)]));
      // Ensure no stray events were created by these moves.
      expect(await tx.select().from(events).where(eq(events.title, "never"))).toHaveLength(0);
    });
  });

  it("out-of-area events from a live source are held, never published, and don't demote it", async () => {
    await inRollback(async (tx) => {
      const [eureka] = await tx
        .insert(venues)
        .values({ slug: `eureka-test-${randomUUID().slice(0, 6)}`, name: "Eureka Test Hall", venueType: "theater", address: "1 Main St", city: "Eureka Springs", lat: 36.4, lng: -93.74, active: true, verification: {} })
        .returning();
      const { lib, rec, run } = await shadowRecord(tx, "Concert Out Of Area", "20271020T010000Z", undefined, { state: "live", venueId: eureka.id });
      const taxonomy = await loadActiveTaxonomy(tx);
      const r = await enrichRecord(tx, rec, { generate: fakeModel(tx), taxonomy, runId: run.id });
      expect(r).toMatchObject({ event: null, shadow: "created" });
      const [item] = await tx.select().from(eventProposals).where(eq(eventProposals.externalId, rec.externalId));
      expect(item.flags).toContain("outside_coverage");
      expect(item.reasons).toContain("outside_coverage_area");
      await expect(approveProposal(tx, item.id, { actor: OWNER })).rejects.toThrow(/outside the coverage area/);
      await rejectProposal(tx, item.id, { actor: OWNER, reason: "out of area", kind: "outside_area" });
      expect(await demoteLiveSources(tx, new Date(), "agent:maintenance")).toEqual([]);
      const [after] = await tx.select().from(sources).where(eq(sources.id, lib.id));
      expect(after.publishState).toBe("live");
      expect((await sourceStats(tx, lib.id)).rejected).toBe(0);
    });
  });

  it("while in shadow, a changed date on an approved event waits as an update item; approval applies it; a cancellation hides at once; a removed event is hidden", async () => {
    await inRollback(async (tx) => {
      const taxonomy = await loadActiveTaxonomy(tx);
      const { lib, rec, run } = await shadowRecord(tx, "Puppet Show Update Test", "20271013T143000Z");
      await enrichRecord(tx, rec, { generate: fakeModel(tx), taxonomy, runId: run.id });
      const [item] = await tx.select().from(eventProposals).where(eq(eventProposals.externalId, rec.externalId));
      const { event } = await approveProposal(tx, item.id, { actor: OWNER });

      // The source moves it an hour later.
      const [stored] = await tx.select().from(rawRecords).where(eq(rawRecords.id, rec.id));
      const moved = { ...stored, status: "mapped" as const, facts: { ...(stored.facts as object), startAt: "2027-10-13T15:30:00.000Z", endAt: "2027-10-13T16:00:00.000Z" } };
      const r = await enrichRecord(tx, moved as never, { generate: fakeModel(tx), taxonomy, runId: run.id });
      expect(r.shadow).toBe("created");
      const [unchanged] = await tx.select().from(events).where(eq(events.id, event.id));
      expect(unchanged.startAt.toISOString()).toBe("2027-10-13T14:30:00.000Z");
      const [update] = await tx.select().from(eventProposals).where(eq(eventProposals.externalId, `${rec.externalId}#update`));
      expect(update).toMatchObject({ status: "pending", reasons: ["shadow_update"], matchEventId: event.id });
      expect((await pendingProposals(tx)).map((p) => p.id)).toContain(update.id);
      await approveProposal(tx, update.id, { actor: OWNER, note: "they moved it" });
      const [applied] = await tx.select().from(events).where(eq(events.id, event.id));
      expect(applied.startAt.toISOString()).toBe("2027-10-13T15:30:00.000Z");

      // A cancellation applies at once.
      const cancelled = { ...moved, facts: { ...moved.facts, status: "cancelled" } };
      await enrichRecord(tx, cancelled as never, { generate: fakeModel(tx), taxonomy, runId: run.id });
      const [gone] = await tx.select().from(events).where(eq(events.id, event.id));
      expect(gone.status).toBe("cancelled");

      // Removal: a second approved event the feed no longer lists, within its reach, is hidden; one beyond it isn't.
      const b = await shadowRecord(tx, "Craft Hour Removal Test", "20271014T143000Z");
      await enrichRecord(tx, b.rec, { generate: fakeModel(tx), taxonomy, runId: b.run.id });
      const [bItem] = await tx.select().from(eventProposals).where(eq(eventProposals.externalId, b.rec.externalId));
      const { event: bEvent } = await approveProposal(tx, bItem.id, { actor: OWNER });
      const now = new Date("2027-10-01T00:00:00Z");
      expect(await hideRemovedShadowEvents(tx, lib, { externalIds: [], lastStart: new Date("2027-10-13T00:00:00Z") }, { actor: "agent:fetch", runId: null, now })).toBe(0);
      expect(await hideRemovedShadowEvents(tx, lib, { externalIds: [], lastStart: new Date("2027-10-30T00:00:00Z") }, { actor: "agent:fetch", runId: null, now })).toBe(1);
      const [bAfter] = await tx.select().from(events).where(eq(events.id, bEvent.id));
      expect(bAfter.status).toBe("hidden");
    });
  });

  it("filter rules: preview lists what they'd catch; removing one restores skipped records and filtered items; weekly skips counted", async () => {
    await inRollback(async (tx) => {
      const taxonomy = await loadActiveTaxonomy(tx);
      const a = await shadowRecord(tx, "Pickleball Open Play", "20271021T230000Z");
      await enrichRecord(tx, a.rec, { generate: fakeModel(tx), taxonomy, runId: a.run.id });
      const b = await shadowRecord(tx, "Pickleball Open Play Evening", "20271022T230000Z");
      await enrichRecord(tx, b.rec, { generate: fakeModel(tx), taxonomy, runId: b.run.id });
      expect((await previewFilter(tx, a.lib.id, "pickleball open play")).map((p) => p.facts.title).sort()).toEqual(["Pickleball Open Play", "Pickleball Open Play Evening"]);

      const { filter, rejected } = await addSourceFilter(tx, a.lib.id, "pickleball open play", { actor: OWNER });
      expect(rejected).toBe(2);
      // A later record the rule skips.
      const c = await shadowRecord(tx, "Pickleball Open Play Morning", "20271023T150000Z");
      await tx.update(rawRecords).set({ status: "skipped", skipReason: `filter:${filter.id}`, processedAt: new Date() }).where(eq(rawRecords.id, c.rec.id));
      expect((await filterSkipsThisWeek(tx, a.lib.id)).get(filter.id)?.map((x) => x.title)).toEqual(["Pickleball Open Play Morning"]);

      const restored = await removeSourceFilter(tx, a.lib.id, filter.id, { actor: OWNER });
      expect(restored).toEqual({ records: 1, items: 2 });
      const [rc] = await tx.select().from(rawRecords).where(eq(rawRecords.id, c.rec.id));
      expect(rc).toMatchObject({ status: "pending", skipReason: null });
      const items = await tx.select().from(eventProposals).where(eq(eventProposals.sourceId, a.lib.id));
      expect(items.filter((i) => i.facts.title.startsWith("Pickleball")).map((i) => i.status)).toEqual(["pending", "pending"]);
    });
  });
});
