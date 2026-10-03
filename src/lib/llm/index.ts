/**
 * The only way to call a language model in this codebase. It:
 * 1. looks up the active llm_models row for the task (model, provider, prices),
 * 2. refuses the call if it could push today's spend past the daily budget,
 * 3. calls the provider adapter with a strict JSON schema,
 * 4. logs every call (success or failure) with tokens and cost to llm_calls,
 * 5. validates the output with zod before returning it.
 *
 * llm_calls rows are written with the pool, not the caller's transaction, so
 * spend is recorded even if the caller's transaction rolls back.
 */
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { getDb, type DbExecutor } from "@/lib/db/client";
import { type LLM_TASKS, llmCalls, llmModels } from "@/lib/db/schema";
import { dailyBudgetUsd, spentTodayUsd } from "./budget";
import { computeCostUsd, estimateMaxCostUsd } from "./cost";
import { LlmError } from "./errors";
import { toStrictJsonSchema } from "./json-schema";
import { getProvider, type ProviderFactory } from "./providers";
import type { ProviderResponse, ProviderUsage } from "./types";
import { DATA_HANDLING_RULES } from "./untrusted";

export { LlmError } from "./errors";
export { wrapUntrusted } from "./untrusted";

export type LlmTask = (typeof LLM_TASKS)[number];
type ModelRow = typeof llmModels.$inferSelect;

export interface GenerateRequest<S extends z.ZodType> {
  task: LlmTask;
  /** Output schema. Optional fields must be .nullable(), not .optional(). */
  schema: S;
  schemaName: string;
  /** Task instructions. DATA_HANDLING_RULES are appended automatically. */
  system: string;
  /** User input. Wrap fetched content with wrapUntrusted(). */
  input: string;
  /** Identifies the prompt revision, e.g. "extract@3". */
  promptVersion: string;
  runId?: string | null;
  signal?: AbortSignal;
}

export interface GenerateResult<T> {
  data: T;
  /** The llm_calls row id; pass to recordAction as llmCallId. */
  callId: string;
  /** The model name; pass to recordAction as model. */
  model: string;
  costUsd: number;
}

/** Test seams. Production code never passes these. */
export interface GenerateDeps {
  db?: DbExecutor;
  providers?: Record<string, ProviderFactory>;
  now?: () => Date;
  budgetUsd?: number;
}

const ZERO_USAGE: ProviderUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

export async function generateStructured<S extends z.ZodType>(
  req: GenerateRequest<S>,
  deps: GenerateDeps = {},
): Promise<GenerateResult<z.output<S>>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? (() => new Date());

  const [model] = await db
    .select()
    .from(llmModels)
    .where(and(eq(llmModels.task, req.task), eq(llmModels.active, true)))
    .limit(1);
  if (!model) throw new LlmError("no_active_model", `No active llm_models row for task "${req.task}"`);

  const provider = getProvider(model.provider, deps.providers);
  provider.validateParams(model.params);
  const jsonSchema = toStrictJsonSchema(req.schema);
  const system = `${req.system.trim()}\n\n${DATA_HANDLING_RULES}`;

  const log = (status: (typeof llmCalls.$inferInsert)["status"], extra: LogExtra = {}) =>
    logCall(db, model, req, status, extra);

  // Budget: refuse if the worst case of this call could exceed today's cap.
  const budget = deps.budgetUsd ?? dailyBudgetUsd();
  const spent = await spentTodayUsd(db, now());
  const worstCase = estimateMaxCostUsd(system.length + req.input.length, model.maxOutputTokens, model);
  if (spent + worstCase > budget) {
    const callId = await log("refused_budget", {
      error: `spent $${spent.toFixed(4)} + worst case $${worstCase.toFixed(4)} > budget $${budget.toFixed(2)}`,
    });
    throw new LlmError("budget_exceeded", `Daily LLM budget of $${budget} reached`, callId);
  }

  const started = Date.now();
  let response: ProviderResponse;
  try {
    response = await provider.generateJson({
      model: model.model,
      system,
      input: req.input,
      jsonSchema,
      schemaName: req.schemaName,
      params: model.params,
      maxOutputTokens: model.maxOutputTokens,
      signal: req.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const callId = await log("error", { error: message, latencyMs: Date.now() - started });
    throw new LlmError("provider_error", message, callId, { cause: err });
  }

  const latencyMs = Date.now() - started;
  const costUsd = computeCostUsd(response.usage, model);
  const billed = { usage: response.usage, costUsd, latencyMs };

  if (response.refusal) {
    const callId = await log("error", { ...billed, error: `refusal: ${response.refusal}` });
    throw new LlmError("refusal", `Model refused: ${response.refusal}`, callId);
  }
  if (response.incompleteReason) {
    const callId = await log("error", { ...billed, error: `incomplete: ${response.incompleteReason}` });
    throw new LlmError("incomplete", `Output incomplete: ${response.incompleteReason}`, callId);
  }

  let parsed: z.output<S>;
  try {
    const result = req.schema.safeParse(JSON.parse(response.text));
    if (!result.success) throw new Error(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    parsed = result.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const callId = await log("invalid_output", { ...billed, error: message.slice(0, 2000) });
    throw new LlmError("invalid_output", `Output failed validation: ${message}`, callId);
  }

  const callId = await log("ok", billed);
  return { data: parsed, callId, model: model.model, costUsd };
}

interface LogExtra {
  usage?: ProviderUsage;
  costUsd?: number;
  latencyMs?: number;
  error?: string;
}

async function logCall(
  db: DbExecutor,
  model: ModelRow,
  req: GenerateRequest<z.ZodType>,
  status: (typeof llmCalls.$inferInsert)["status"],
  { usage = ZERO_USAGE, costUsd = 0, latencyMs, error }: LogExtra,
): Promise<string> {
  const [row] = await db
    .insert(llmCalls)
    .values({
      runId: req.runId ?? null,
      llmModelId: model.id,
      task: req.task,
      provider: model.provider,
      model: model.model,
      promptVersion: req.promptVersion,
      inputTokens: usage.inputTokens,
      cachedTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      costUsd,
      latencyMs: latencyMs ?? null,
      status,
      error: error ?? null,
    })
    .returning({ id: llmCalls.id });
  return row.id;
}
