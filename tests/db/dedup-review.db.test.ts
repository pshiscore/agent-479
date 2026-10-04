import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { agentActor, humanActor } from "@/lib/actions/record";
import { DedupReviewError, labelPair, reviewQueue, suggestedThresholds } from "@/lib/admin/dedup-review";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, categories, dedupLabels, eventSources, events, llmCalls, sources, venues } from "@/lib/db/schema";
import type { GenerateRequest } from "@/lib/llm";
import { runDedup } from "@/lib/pipeline/dedup";
import type { Generate } from "@/lib/pipeline/enrich/types";
import { setDedupMode, SourceStateError } from "@/lib/sources/admin";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const OWNER = humanActor("owner");
const tag = randomUUID().slice(0, 8);

async function setup(tx: DbTx) {
  const [src] = await tx
    .insert(sources)
    .values({ slug: `dr-${tag}-${randomUUID().slice(0, 4)}`, name: "Review Source", kind: "ics", fetcher: "ics", baseUrl: "https://x.example/", trustLevel: 3, fetchIntervalMinutes: 60, termsNotes: "t" })
    .returning();
  const [venue] = await tx.select().from(venues).where(eq(venues.slug, "rogers-historical-museum"));
  const [cat] = await tx.select().from(categories).where(eq(categories.slug, "talks-learning"));
  let n = 0;
  const add = async (title: string, iso: string) => {
    const [ev] = await tx.insert(events).values({ slug: `dr-${tag}-${++n}`, title, normalizedTitle: title.toLowerCase(), startAt: new Date(iso), venueId: venue.id, categoryId: cat.id }).returning();
    await tx.insert(eventSources).values({ eventId: ev.id, sourceId: src.id, externalId: `x-${tag}-${n}`, isPrimary: true });
    return ev;
  };
  const generate = vi.fn(async (req: GenerateRequest<z.ZodType>) => {
    const [call] = await tx.insert(llmCalls).values({ task: req.task, provider: "fake", model: "fake-model", status: "ok", promptVersion: req.promptVersion }).returning({ id: llmCalls.id });
    return { data: req.schema.parse({ same: false, confidence: 0.9 }), callId: call.id, model: "fake-model", costUsd: 0 };
  }) as unknown as Generate;
  return { src, add, generate };
}

describe("dedup review", () => {
  it("queues one pair per pair of titles, nearest first, and labels freeze the facts, logged", async () => {
    await inRollback(async (tx) => {
      const { src, add, generate } = await setup(tx);
      // Two weeks of the same two programs side by side (two candidate pairs, one title pair).
      for (const day of ["2027-09-07", "2027-09-14"]) {
        await add("Math Olympiads Elementary", `${day}T23:00:00Z`);
        await add("Math Olympiads Middle", `${day}T23:00:00Z`);
      }
      await runDedup(tx, { now: new Date("2026-10-04T15:00:00Z"), actor: agentActor("process"), generate, sourceId: src.id });
      const mine = (await reviewQueue(tx, 500)).filter((q) => q.a.source === src.slug);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ sameTitlePairs: 2 });

      const row = await labelPair(tx, mine[0].candidateId, "different", { actor: OWNER, note: "different grade groups" });
      expect(row).toMatchObject({ label: "different", labeledBy: OWNER, sourceIds: [src.id] });
      expect(row.factsA).toMatchObject({ title: expect.stringMatching(/Math Olympiads/), source: src.slug });
      const [log] = await tx.select().from(agentActions).where(and(eq(agentActions.entityType, "dedup_label"), eq(agentActions.entityId, row.id)));
      expect(log.reason).toMatch(/as different: different grade groups/);
      // Labeled: that pair of titles leaves the queue, sibling included.
      expect((await reviewQueue(tx, 500)).filter((q) => q.a.source === src.slug)).toHaveLength(0);
      await expect(labelPair(tx, mine[0].candidateId, "same", { actor: OWNER })).rejects.toBeInstanceOf(DedupReviewError);
      await expect(labelPair(tx, mine[0].candidateId, "same", { actor: agentActor("x") })).rejects.toThrow(/only a person/);
      expect((await suggestedThresholds(tx)).counts.labels).toBeGreaterThanOrEqual(1);
      expect(await tx.select().from(dedupLabels).where(eq(dedupLabels.id, row.id))).toHaveLength(1);
    });
  });

  it("won't take a source live until enough of its pairs are labeled; the switch is logged", async () => {
    await inRollback(async (tx) => {
      const { src, add, generate } = await setup(tx);
      await add("Ghost Walk", "2027-09-10T00:00:00Z");
      await add("Ghost Tour", "2027-09-10T00:00:00Z");
      await runDedup(tx, { now: new Date("2026-10-04T15:00:00Z"), actor: agentActor("process"), generate, sourceId: src.id });
      await expect(setDedupMode(tx, src.slug, "live", "Labels look good to me", OWNER)).rejects.toThrow(/label at least 1/);
      const [item] = (await reviewQueue(tx, 500)).filter((q) => q.a.source === src.slug);
      await labelPair(tx, item.candidateId, "different", { actor: OWNER });
      const after = await setDedupMode(tx, src.slug, "live", "Labels look good to me", OWNER);
      expect(after.dedupMode).toBe("live");
      await expect(setDedupMode(tx, src.slug, "live", "again please", OWNER)).rejects.toBeInstanceOf(SourceStateError);
      const [log] = await tx.select().from(agentActions).where(and(eq(agentActions.entityId, src.id), eq(agentActions.action, "update")));
      expect(log.reason).toMatch(/^Dedup live:/);
    });
  });
});
