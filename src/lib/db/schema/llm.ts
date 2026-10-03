import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, sqlList, updatedAt } from "./columns";
import { runs } from "./runs";

export const LLM_TASKS = [
  "extract",
  "classify",
  "describe",
  "dedup_tiebreak",
  "venue_pick",
  "digest",
] as const;
export const LLM_CALL_STATUSES = ["ok", "error", "invalid_output", "refused_budget"] as const;

const usdPerMtok = (name: string) => numeric(name, { precision: 12, scale: 6, mode: "number" });

/**
 * Which model serves each task, and what it costs. The only place model names
 * live: switching model or provider is a row change, never a code change.
 */
export const llmModels = pgTable(
  "llm_models",
  {
    id: id(),
    task: text("task", { enum: LLM_TASKS }).notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    // Provider-specific request params, e.g. { "reasoning_effort": "low" }.
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    maxOutputTokens: integer("max_output_tokens"),
    inputCostPerMtok: usdPerMtok("input_cost_per_mtok").notNull(),
    cachedInputCostPerMtok: usdPerMtok("cached_input_cost_per_mtok"),
    cacheWriteCostPerMtok: usdPerMtok("cache_write_cost_per_mtok"),
    outputCostPerMtok: usdPerMtok("output_cost_per_mtok").notNull(),
    pricingSourceUrl: text("pricing_source_url").notNull(),
    pricingCheckedAt: timestamp("pricing_checked_at", { withTimezone: true }).notNull(),
    active: boolean("active").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // At most one active model per task.
    uniqueIndex("llm_models_active_task_uniq").on(t.task).where(sql`${t.active}`),
    check("llm_models_task_check", sql.raw(`task in ${sqlList(LLM_TASKS)}`)),
  ],
).enableRLS();

/** One row per LLM request, successful or not. Source of truth for spend. */
export const llmCalls = pgTable(
  "llm_calls",
  {
    id: id(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    llmModelId: uuid("llm_model_id").references(() => llmModels.id, { onDelete: "set null" }),
    task: text("task", { enum: LLM_TASKS }).notNull(),
    // Copied from llm_models at call time so history survives row edits.
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull().default(0),
    latencyMs: integer("latency_ms"),
    status: text("status", { enum: LLM_CALL_STATUSES }).notNull(),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("llm_calls_created_idx").on(t.createdAt),
    index("llm_calls_task_created_idx").on(t.task, t.createdAt),
    index("llm_calls_run_idx").on(t.runId),
    check("llm_calls_task_check", sql.raw(`task in ${sqlList(LLM_TASKS)}`)),
    check("llm_calls_status_check", sql.raw(`status in ${sqlList(LLM_CALL_STATUSES)}`)),
  ],
).enableRLS();
