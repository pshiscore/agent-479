import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { humanActor } from "@/lib/actions/record";
import { confirmSource, createPlace, PlaceError, removePlaceDescription, writePlaceDescription } from "@/lib/admin/places";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, llmCalls } from "@/lib/db/schema";
import type { GenerateRequest } from "@/lib/llm";
import type { Generate } from "@/lib/pipeline/enrich/types";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const OWNER = humanActor("owner");
const tag = randomUUID().slice(0, 6);

function fake(tx: DbTx, ...answers: { description: string | null; usedFacts: number[] }[]) {
  let i = 0;
  return vi.fn(async (req: GenerateRequest<z.ZodType>) => {
    const [call] = await tx.insert(llmCalls).values({ task: req.task, provider: "fake", model: "fake-model", status: "ok", promptVersion: req.promptVersion }).returning({ id: llmCalls.id });
    return { data: req.schema.parse(answers[Math.min(i++, answers.length - 1)]), callId: call.id, model: "fake-model", costUsd: 0 };
  }) as unknown as Generate;
}

describe("place descriptions (admin)", () => {
  it("writes from stated facts as a logged agent action; changed facts remove it; the owner can remove it", async () => {
    await inRollback(async (tx) => {
      const p = await createPlace(tx, { name: `Desc Cafe ${tag}`, placeType: "cafe", kind: "new", address: "1 Test St", city: "Rogers", opened: "2026-09-01" }, { actor: OWNER, ownerVerified: false, reason: "test" });
      // No stated facts yet: no model call, nothing written.
      const none = fake(tx, { description: "unused text here for the schema", usedFacts: [0] });
      expect((await writePlaceDescription(tx, p.id, { requestedBy: OWNER, generate: none })).status).toBe("none");
      expect(none).not.toHaveBeenCalled();

      await confirmSource(tx, p.id, { actor: OWNER, url: "https://x.example/a", confirmed: "Opened Sept 1", openToPublic: true, facts: ["Serves breakfast and lunch"] });
      const r = await writePlaceDescription(tx, p.id, { requestedBy: OWNER, generate: fake(tx, { description: "A new cafe serving breakfast and lunch.", usedFacts: [0] }) });
      expect(r.status).toBe("ok");
      const [log] = await tx.select().from(agentActions).where(and(eq(agentActions.entityId, p.id), eq(agentActions.actor, "agent:place-describe")));
      expect(log).toMatchObject({ action: "update", model: "fake-model" });
      expect(log.llmCallId).toBeTruthy();
      expect(log.reason).toContain("Serves breakfast and lunch");

      // Same facts again: the description stays. New facts: it's removed in the same logged update.
      const same = await confirmSource(tx, p.id, { actor: OWNER, url: "https://x.example/a", confirmed: "Opened Sept 1", openToPublic: true, facts: ["Serves breakfast and lunch"] });
      expect(same.description).toBe("A new cafe serving breakfast and lunch.");
      const changed = await confirmSource(tx, p.id, { actor: OWNER, url: "https://x.example/a", confirmed: "Opened Sept 1", openToPublic: true, facts: ["Has a drive-through"] });
      expect(changed).toMatchObject({ description: null, descriptionGeneratedAt: null });

      await writePlaceDescription(tx, p.id, { requestedBy: OWNER, generate: fake(tx, { description: "A new cafe with a drive-through window.", usedFacts: [0] }) });
      expect((await removePlaceDescription(tx, p.id, { actor: OWNER, reason: "test" })).description).toBeNull();
      await expect(writePlaceDescription(tx, p.id, { requestedBy: "agent:x", generate: none })).rejects.toBeInstanceOf(PlaceError);
    });
  });

  it("holds a draft that fails the checks twice: logged, nothing stored", async () => {
    await inRollback(async (tx) => {
      const p = await createPlace(tx, { name: `Held Cafe ${tag}`, placeType: "cafe", kind: "new", address: "1 Test St", city: "Rogers", opened: "2026-09-01", sourceUrl: "https://x.example/h" }, { actor: OWNER, ownerVerified: false, reason: "test" });
      await confirmSource(tx, p.id, { actor: OWNER, url: "https://x.example/h", confirmed: "seen", openToPublic: true, facts: ["Serves breakfast and lunch"] });
      const r = await writePlaceDescription(tx, p.id, { requestedBy: OWNER, generate: fake(tx, { description: "The best cafe in Rogers for breakfast and lunch.", usedFacts: [0] }) });
      expect(r.status).toBe("held");
      const holds = await tx.select().from(agentActions).where(and(eq(agentActions.entityId, p.id), eq(agentActions.action, "hold")));
      expect(holds).toHaveLength(1);
    });
  });
});
