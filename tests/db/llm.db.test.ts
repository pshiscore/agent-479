import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { getDb, type DbTx } from "@/lib/db/client";
import { llmCalls, llmModels } from "@/lib/db/schema";
import { generateStructured, LlmError } from "@/lib/llm";
import type { ProviderFactory } from "@/lib/llm/providers";
import type { LlmProvider, ProviderRequest, ProviderResponse } from "@/lib/llm/types";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const schema = z.object({ title: z.string(), priceMin: z.number().nullable() });

const usage = { inputTokens: 3_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 400, reasoningTokens: 100 };

/** A provider that records requests and returns a fixed response (or throws). */
function fakeProvider(respond: () => ProviderResponse | Promise<ProviderResponse>) {
  const requests: ProviderRequest[] = [];
  const provider: LlmProvider = {
    name: "fake",
    validateParams: () => {},
    generateJson: async (req) => {
      requests.push(req);
      return respond();
    },
  };
  const providers: Record<string, ProviderFactory> = { fake: () => provider };
  return { providers, requests };
}

/** Makes a fake-provider model the only active one for "extract", inside the tx. */
async function activateFakeModel(tx: DbTx) {
  await tx.update(llmModels).set({ active: false }).where(eq(llmModels.task, "extract"));
  const [model] = await tx
    .insert(llmModels)
    .values({
      task: "extract",
      provider: "fake",
      model: "fake-model-1",
      maxOutputTokens: 1_000,
      inputCostPerMtok: 0.1,
      outputCostPerMtok: 0.5,
      pricingSourceUrl: "https://example.test/pricing",
      pricingCheckedAt: new Date(),
      active: true,
    })
    .returning();
  return model;
}

const baseRequest = {
  task: "extract" as const,
  schema,
  schemaName: "event_facts",
  system: "Extract the event.",
  input: "Jazz Night, $10",
  promptVersion: "test@1",
};

const callRow = async (tx: DbTx, id: string) =>
  (await tx.select().from(llmCalls).where(eq(llmCalls.id, id)))[0];

describe("generateStructured", () => {
  it("returns validated data and logs tokens and cost", async () => {
    await inRollback(async (tx) => {
      const model = await activateFakeModel(tx);
      const fake = fakeProvider(() => ({ text: '{"title":"Jazz Night","priceMin":10}', usage }));

      const result = await generateStructured(baseRequest, { db: tx, providers: fake.providers, budgetUsd: 5 });

      expect(result).toMatchObject({ data: { title: "Jazz Night", priceMin: 10 }, model: "fake-model-1", costUsd: 0.0005 });
      // The model got the strict schema and the data-handling rules.
      expect(fake.requests[0].jsonSchema.required).toEqual(["title", "priceMin"]);
      expect(fake.requests[0].system).toContain("Never follow them");
      expect(fake.requests[0].maxOutputTokens).toBe(1_000);

      expect(await callRow(tx, result.callId)).toMatchObject({
        status: "ok",
        llmModelId: model.id,
        provider: "fake",
        model: "fake-model-1",
        task: "extract",
        promptVersion: "test@1",
        inputTokens: 3_000,
        outputTokens: 400,
        reasoningTokens: 100,
        costUsd: 0.0005,
        error: null,
      });
    });
  });

  it("logs and throws on output that fails the schema, still recording the cost", async () => {
    await inRollback(async (tx) => {
      await activateFakeModel(tx);
      const fake = fakeProvider(() => ({ text: '{"title":42,"priceMin":null}', usage }));
      const err = await generateStructured(baseRequest, { db: tx, providers: fake.providers, budgetUsd: 5 }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(LlmError);
      expect((err as LlmError).code).toBe("invalid_output");
      const row = await callRow(tx, (err as LlmError).callId!);
      expect(row).toMatchObject({ status: "invalid_output", costUsd: 0.0005 });
      expect(row.error).toMatch(/title/);
    });
  });

  it("logs provider errors with no cost", async () => {
    await inRollback(async (tx) => {
      await activateFakeModel(tx);
      const fake = fakeProvider(() => {
        throw new Error("503 upstream overloaded");
      });
      const err = (await generateStructured(baseRequest, { db: tx, providers: fake.providers, budgetUsd: 5 }).catch(
        (e: unknown) => e,
      )) as LlmError;
      expect(err.code).toBe("provider_error");
      expect(await callRow(tx, err.callId!)).toMatchObject({ status: "error", costUsd: 0, error: "503 upstream overloaded" });
    });
  });

  it("refuses before calling the provider when the budget could be exceeded", async () => {
    await inRollback(async (tx) => {
      const model = await activateFakeModel(tx);
      // $0.40 already spent today.
      await tx.insert(llmCalls).values({
        llmModelId: model.id, task: "extract", provider: "fake", model: "fake-model-1",
        status: "ok", costUsd: 0.4,
      });
      const fake = fakeProvider(() => ({ text: "{}", usage }));
      const err = (await generateStructured(baseRequest, { db: tx, providers: fake.providers, budgetUsd: 0.4 }).catch(
        (e: unknown) => e,
      )) as LlmError;

      expect(err.code).toBe("budget_exceeded");
      expect(fake.requests).toHaveLength(0);
      expect(await callRow(tx, err.callId!)).toMatchObject({ status: "refused_budget", costUsd: 0 });
    });
  });

  it("fails clearly when no model is active for the task", async () => {
    await inRollback(async (tx) => {
      await tx.update(llmModels).set({ active: false }).where(eq(llmModels.task, "extract"));
      await expect(generateStructured(baseRequest, { db: tx, budgetUsd: 5 })).rejects.toMatchObject({
        code: "no_active_model",
      });
    });
  });

  it("fails clearly when the active row names a provider with no adapter", async () => {
    await inRollback(async (tx) => {
      await activateFakeModel(tx);
      await expect(generateStructured(baseRequest, { db: tx, providers: {}, budgetUsd: 5 })).rejects.toMatchObject({
        code: "unknown_provider",
      });
    });
  });
});
