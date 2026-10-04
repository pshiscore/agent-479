import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { loadActiveTaxonomy } from "@/lib/categories";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, eventSources, events, eventTags, llmCalls, rawRecords, sources, tags, venues } from "@/lib/db/schema";
import type { GenerateRequest } from "@/lib/llm";
import { enrichRecord } from "@/lib/pipeline/enrich";
import type { Generate } from "@/lib/pipeline/enrich/types";
import { mapRecord } from "@/lib/pipeline/map";
import { startRun } from "@/lib/runs";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const SOURCE_TEXT = "Songs rhymes and picture books for children ages three to five with our friendly librarians every single week.";

/** A fake model that, like the real wrapper, records each call in llm_calls. */
function fakeModel(tx: DbTx, outputs: Record<string, unknown[]>) {
  const n: Record<string, number> = {};
  return vi.fn(async (req: GenerateRequest<z.ZodType>) => {
    const i = (n[req.task] = (n[req.task] ?? 0) + 1) - 1;
    const list = outputs[req.task];
    const [call] = await tx
      .insert(llmCalls)
      .values({ task: req.task, provider: "fake", model: "fake-model", status: "ok", promptVersion: req.promptVersion })
      .returning({ id: llmCalls.id });
    return { data: req.schema.parse(list[Math.min(i, list.length - 1)]), callId: call.id, model: "fake-model", costUsd: 0 };
  }) as unknown as Generate;
}

async function mappedRecord(tx: DbTx, description: string | null) {
  const [lib] = await tx.select().from(sources).where(eq(sources.slug, "library-fayetteville"));
  const [venue] = await tx.select().from(venues).where(eq(venues.slug, "fayetteville-public-library"));
  const run = await startRun(tx, "fetch", { sourceId: lib.id });
  const payload = {
    format: "ics",
    feed: { url: "https://faylib.org/feeds", defaultTimezone: null, timezones: [] },
    event: {
      uid: "990001", recurrenceId: null, summary: "Preschool Story Time", dtstart: { value: "20261013T143000Z", isDate: false }, dtend: null,
      duration: "PT30M", rrule: null, rdate: [], exdate: [], location: "Fayetteville Public Library - Walmart Story Time Room (1st Floor)",
      geo: null, url: null, status: "CONFIRMED", categories: [], sequence: null, lastModified: null,
    },
  };
  const facts = mapRecord(payload, lib);
  const [rec] = await tx
    .insert(rawRecords)
    .values({
      sourceId: lib.id, runId: run.id, externalId: `test-${randomUUID()}`, contentHash: "h", payload, descriptionText: description,
      status: "mapped", facts, venueId: venue.id, subSpace: "Walmart Story Time Room (1st Floor)", venueMatchedBy: "default_venue",
    })
    .returning();
  return { rec, run };
}

describe("enrichRecord", () => {
  it("writes the event, source row, and tags (with code-set Free), logged with the Community hint", async () => {
    await inRollback(async (tx) => {
      const { rec, run } = await mappedRecord(tx, SOURCE_TEXT);
      const generate = fakeModel(tx, {
        extract: [{ isFree: true, priceMin: null, priceMax: null, ageRestriction: "all_ages", familyFriendly: true, registrationRequired: false }],
        classify: [{ category: "community", tags: [], closestMissingCategory: "Library programs" }],
        describe: [{ description: "A short morning of stories and songs for preschoolers at the library." }],
      });
      const taxonomy = await loadActiveTaxonomy(tx);
      const r = await enrichRecord(tx, rec, { generate, taxonomy, runId: run.id });
      expect(r).toMatchObject({ created: true, category: "community", held: false });
      expect(r.tags.sort()).toEqual(["family-friendly", "free"]);

      const [ev] = await tx.select().from(events).where(eq(events.id, r.event.id));
      expect(ev).toMatchObject({
        title: "Preschool Story Time",
        startAt: new Date("2026-10-13T14:30:00.000Z"),
        endAt: new Date("2026-10-13T15:00:00.000Z"),
        subSpace: "Walmart Story Time Room (1st Floor)",
        isFree: true,
        primarySourceUrl: "https://faylib.org/event/990001",
        shortDescription: "A short morning of stories and songs for preschoolers at the library.",
        status: "scheduled",
      });
      expect(ev.slug).toBe("preschool-story-time-2026-10-13");
      const evTags = await tx.select({ slug: tags.slug }).from(eventTags).innerJoin(tags, eq(tags.id, eventTags.tagId)).where(eq(eventTags.eventId, ev.id));
      expect(evTags.map((t) => t.slug).sort()).toEqual(["family-friendly", "free"]);
      const [src] = await tx.select().from(eventSources).where(eq(eventSources.eventId, ev.id));
      expect(src).toMatchObject({ isPrimary: true, rawRecordId: rec.id, externalId: rec.externalId });
      const [after] = await tx.select().from(rawRecords).where(eq(rawRecords.id, rec.id));
      expect(after).toMatchObject({ status: "extracted", eventId: ev.id });

      const [action] = await tx.select().from(agentActions).where(and(eq(agentActions.entityId, ev.id), eq(agentActions.action, "insert")));
      expect(action).toMatchObject({ actor: "agent:process", model: "fake-model", entityType: "event" });
      expect((action.after as { _meta: { closestMissingCategory: string } })._meta.closestMissingCategory).toBe("Library programs");
      expect((action.after as { tagIds: string[] }).tagIds).toHaveLength(2);
    });
  });

  it("updates the same event on re-enrichment, logging before and after with tags", async () => {
    await inRollback(async (tx) => {
      const { rec, run } = await mappedRecord(tx, null);
      const taxonomy = await loadActiveTaxonomy(tx);
      const first = fakeModel(tx, { classify: [{ category: "family-kids", tags: [], closestMissingCategory: null }], describe: [{ description: "Stories and songs for young children at the library." }] });
      const a = await enrichRecord(tx, rec, { generate: first, taxonomy, runId: run.id });
      // The source changes; the record is mapped again and re-enriched.
      const [again] = await tx.update(rawRecords).set({ status: "mapped" }).where(eq(rawRecords.id, rec.id)).returning();
      const second = fakeModel(tx, { classify: [{ category: "family-kids", tags: ["outdoor"], closestMissingCategory: null }], describe: [{ description: "Stories and songs for young children, outdoors this week." }] });
      const b = await enrichRecord(tx, again, { generate: second, taxonomy, runId: run.id });
      expect(b).toMatchObject({ created: false });
      expect(b.event.id).toBe(a.event.id);
      expect(await tx.select().from(events).where(eq(events.id, a.event.id))).toHaveLength(1);
      const [upd] = await tx.select().from(agentActions).where(and(eq(agentActions.entityId, a.event.id), eq(agentActions.action, "update")));
      expect((upd.before as { tagIds: string[] }).tagIds).toEqual([]);
      expect((upd.after as { tagIds: string[] }).tagIds).toHaveLength(1);
      expect(await tx.select().from(eventSources).where(eq(eventSources.eventId, a.event.id))).toHaveLength(1);
    });
  });

  it("holds a description that keeps copying the source: no description, a logged hold", async () => {
    await inRollback(async (tx) => {
      const { rec, run } = await mappedRecord(tx, SOURCE_TEXT);
      const copied = "Songs rhymes and picture books for children ages three to five with our friendly librarians.";
      const generate = fakeModel(tx, {
        extract: [{ isFree: null, priceMin: null, priceMax: null, ageRestriction: null, familyFriendly: null, registrationRequired: null }],
        classify: [{ category: "family-kids", tags: [], closestMissingCategory: null }],
        describe: [{ description: copied }],
      });
      const r = await enrichRecord(tx, rec, { generate, taxonomy: await loadActiveTaxonomy(tx), runId: run.id });
      expect(r.held).toBe(true);
      const [ev] = await tx.select().from(events).where(eq(events.id, r.event.id));
      expect(ev.shortDescription).toBeNull();
      const [hold] = await tx.select().from(agentActions).where(and(eq(agentActions.entityId, ev.id), eq(agentActions.action, "hold")));
      expect(hold.reason).toMatch(/held for review/);
    });
  });
});
