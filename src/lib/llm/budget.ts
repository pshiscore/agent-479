import { gte, sum } from "drizzle-orm";
import type { DbExecutor } from "@/lib/db/client";
import { llmCalls } from "@/lib/db/schema";
import { chicagoDate, chicagoToUtc } from "@/lib/time";
import { LlmError } from "./errors";

/** The daily cap from LLM_DAILY_BUDGET_USD. Missing or invalid fails closed. */
export function dailyBudgetUsd(env: Record<string, string | undefined> = process.env): number {
  const raw = env.LLM_DAILY_BUDGET_USD;
  const value = raw ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value < 0) {
    throw new LlmError(
      "invalid_config",
      "LLM_DAILY_BUDGET_USD must be set to a non-negative number; refusing LLM calls",
    );
  }
  return value;
}

/** Spend since midnight Chicago time today. */
export async function spentTodayUsd(db: DbExecutor, now: Date = new Date()): Promise<number> {
  const dayStart = chicagoToUtc(chicagoDate(now));
  const [row] = await db
    .select({ total: sum(llmCalls.costUsd) })
    .from(llmCalls)
    .where(gte(llmCalls.createdAt, dayStart));
  return Number(row?.total ?? 0);
}
