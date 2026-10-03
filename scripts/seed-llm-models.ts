/**
 * Seeds llm_models: which model serves each task, and its prices.
 * Idempotent: matches rows on (task, provider, model) and only writes changes,
 * logging each insert/update through recordAction.
 *
 * Usage: npm run db:seed:llm
 * Re-check prices at PRICING_SOURCE before changing them here.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { and, eq } from "drizzle-orm";
import { humanActor, recordAction } from "@/lib/actions/record";
import { getDb } from "@/lib/db/client";
import { type LLM_TASKS, llmModels } from "@/lib/db/schema";
import { withRun } from "@/lib/runs";

type Task = (typeof LLM_TASKS)[number];
type NewModel = typeof llmModels.$inferInsert;

const PRICING_SOURCE = "https://developers.openai.com/api/docs/pricing";
// Prices verified against PRICING_SOURCE on this date.
const PRICING_CHECKED_AT = new Date("2026-10-03T12:00:00Z");

const GPT_6_LUNA = {
  provider: "openai",
  model: "gpt-6-luna",
  inputCostPerMtok: 0.1,
  cachedInputCostPerMtok: 0.01,
  cacheWriteCostPerMtok: 0.125,
  outputCostPerMtok: 0.5,
  pricingSourceUrl: PRICING_SOURCE,
  pricingCheckedAt: PRICING_CHECKED_AT,
} as const;

const GPT_5_NANO = {
  provider: "openai",
  model: "gpt-5-nano",
  inputCostPerMtok: 0.05,
  cachedInputCostPerMtok: 0.005,
  cacheWriteCostPerMtok: null,
  outputCostPerMtok: 0.4,
  pricingSourceUrl: PRICING_SOURCE,
  pricingCheckedAt: PRICING_CHECKED_AT,
} as const;

// max_output_tokens includes reasoning tokens; sized with headroom for each task.
const ACTIVE: Record<Task, { effort: string; maxOutputTokens: number }> = {
  extract: { effort: "low", maxOutputTokens: 4_000 },
  classify: { effort: "low", maxOutputTokens: 1_500 },
  dedup_tiebreak: { effort: "low", maxOutputTokens: 1_500 },
  venue_pick: { effort: "low", maxOutputTokens: 1_000 },
  describe: { effort: "medium", maxOutputTokens: 2_000 },
  digest: { effort: "medium", maxOutputTokens: 6_000 },
};

const ROWS: NewModel[] = [
  ...Object.entries(ACTIVE).map(([task, cfg]) => ({
    ...GPT_6_LUNA,
    task: task as Task,
    params: { reasoning_effort: cfg.effort },
    maxOutputTokens: cfg.maxOutputTokens,
    active: true,
  })),
  // Cheaper previous-generation model, kept inactive for A/B evals on extraction.
  {
    ...GPT_5_NANO,
    task: "extract",
    params: { reasoning_effort: "low" },
    maxOutputTokens: 4_000,
    active: false,
  },
];

const COMPARED = [
  "params",
  "maxOutputTokens",
  "inputCostPerMtok",
  "cachedInputCostPerMtok",
  "cacheWriteCostPerMtok",
  "outputCostPerMtok",
  "pricingSourceUrl",
  "pricingCheckedAt",
  "active",
] as const;

const normalize = (v: unknown) => (v instanceof Date ? v.toISOString() : JSON.stringify(v ?? null));

async function main() {
  const db = getDb();
  const actor = humanActor("seed-llm-models");

  const stats = await withRun(db, "seed", async (run) => {
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    await db.transaction(async (tx) => {
      // Inactive rows first, so a seed that swaps a task's active model turns
      // the old one off before turning the new one on (one-active-per-task index).
      for (const row of [...ROWS].sort((a, b) => Number(a.active) - Number(b.active))) {
        const [existing] = await tx
          .select()
          .from(llmModels)
          .where(
            and(
              eq(llmModels.task, row.task),
              eq(llmModels.provider, row.provider),
              eq(llmModels.model, row.model),
            ),
          );

        if (!existing) {
          const [created] = await tx.insert(llmModels).values(row).returning();
          await recordAction(tx, {
            runId: run.id,
            actor,
            job: "seed",
            action: "insert",
            entityType: "llm_model",
            entityId: created.id,
            after: created,
            reason: `Seed ${row.model} for task ${row.task}`,
          });
          inserted++;
          continue;
        }

        const changes = Object.fromEntries(
          COMPARED.filter((k) => normalize(existing[k]) !== normalize(row[k])).map((k) => [k, row[k]]),
        );
        if (Object.keys(changes).length === 0) {
          unchanged++;
          continue;
        }
        const [after] = await tx
          .update(llmModels)
          .set(changes)
          .where(eq(llmModels.id, existing.id))
          .returning();
        await recordAction(tx, {
          runId: run.id,
          actor,
          job: "seed",
          action: "update",
          entityType: "llm_model",
          entityId: existing.id,
          before: existing,
          after,
          reason: `Seed update for ${row.model}/${row.task}: ${Object.keys(changes).join(", ")}`,
        });
        updated++;
      }
    });
    return { inserted, updated, unchanged };
  });

  console.log("llm_models seed:", stats);
  await db.$client.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
