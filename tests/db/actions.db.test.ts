import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { agentActor, proposeOnce, recordAction } from "@/lib/actions/record";
import { getDb } from "@/lib/db/client";
import { agentActions, llmModels, runs } from "@/lib/db/schema";
import { startRun, withRun } from "@/lib/runs";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

describe("recordAction", () => {
  it("stores the action with its run and JSON snapshots", async () => {
    await inRollback(async (tx) => {
      const run = await startRun(tx, "manual");
      const entityId = randomUUID();
      const at = new Date("2026-10-09T23:00:00Z");
      const row = await recordAction(tx, {
        runId: run.id,
        actor: agentActor("manual"),
        job: "manual",
        action: "update",
        entityType: "event",
        entityId,
        before: { startAt: at, title: "Jazz Nite" },
        after: { startAt: at, title: "Jazz Night" },
        reason: "Source corrected the title",
        model: "gpt-6-luna",
        confidence: 0.92,
      });

      const [stored] = await tx.select().from(agentActions).where(eq(agentActions.id, row.id));
      expect(stored).toMatchObject({ runId: run.id, entityId, action: "update", confidence: 0.92 });
      // Dates are stored as ISO strings inside the JSON snapshot.
      expect(stored.after).toEqual({ startAt: "2026-10-09T23:00:00.000Z", title: "Jazz Night" });
    });
  });

  it("commits with the change or not at all", async () => {
    const pricing = {
      task: "extract" as const,
      provider: "openai",
      model: `atomicity-test-${randomUUID()}`,
      inputCostPerMtok: 0.1,
      outputCostPerMtok: 0.5,
      pricingSourceUrl: "https://example.test",
      pricingCheckedAt: new Date(),
    };
    await expect(
      getDb().transaction(async (tx) => {
        const [model] = await tx.insert(llmModels).values(pricing).returning();
        await recordAction(tx, {
          actor: agentActor("manual"),
          action: "insert",
          entityType: "llm_model",
          entityId: model.id,
          after: model,
          reason: "atomicity test",
        });
        throw new Error("simulated failure after the change");
      }),
    ).rejects.toThrow("simulated failure");

    const [{ n }] = await getDb()
      .select({ n: count() })
      .from(llmModels)
      .where(eq(llmModels.model, pricing.model));
    expect(n).toBe(0);
  });

  it("rejects invalid input before touching the database", async () => {
    await expect(
      recordAction(getDb(), {
        actor: "robot",
        action: "update",
        entityType: "event",
        entityId: randomUUID(),
        reason: "x",
      }),
    ).rejects.toThrow();
  });
});

describe("proposeOnce", () => {
  it("skips a proposal whose dedupe key is already pending", async () => {
    await inRollback(async (tx) => {
      const input = {
        actor: agentActor("maintenance"),
        action: "propose_venue" as const,
        entityType: "venue",
        after: { name: "Test Venue", city: "Rogers" },
        approvalStatus: "pending" as const,
        dedupeKey: `test-venue|rogers|${randomUUID()}`,
        reason: "Unmatched location seen in 2 events",
      };
      expect(await proposeOnce(tx, input)).not.toBeNull();
      expect(await proposeOnce(tx, input)).toBeNull();
    });
  });
});

describe("withRun", () => {
  it("marks a successful run ok with its stats", async () => {
    await inRollback(async (tx) => {
      let runId = "";
      await withRun(tx, "manual", async (run) => {
        runId = run.id;
        return { fetched: 3 };
      });
      const [run] = await tx.select().from(runs).where(eq(runs.id, runId));
      expect(run).toMatchObject({ status: "ok", stats: { fetched: 3 }, error: null });
      expect(run.finishedAt).toBeInstanceOf(Date);
    });
  });

  it("marks a throwing run failed and rethrows", async () => {
    await inRollback(async (tx) => {
      let runId = "";
      await expect(
        withRun(tx, "manual", async (run) => {
          runId = run.id;
          throw new Error("source timed out");
        }),
      ).rejects.toThrow("source timed out");
      const [run] = await tx.select().from(runs).where(eq(runs.id, runId));
      expect(run).toMatchObject({ status: "failed", error: "source timed out" });
    });
  });
});
