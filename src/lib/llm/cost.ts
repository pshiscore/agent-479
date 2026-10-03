import type { ProviderUsage } from "./types";

/** Prices in USD per million tokens, as stored in llm_models. */
export interface ModelPricing {
  inputCostPerMtok: number;
  cachedInputCostPerMtok: number | null;
  cacheWriteCostPerMtok: number | null;
  outputCostPerMtok: number;
}

const PER_TOKEN = 1 / 1_000_000;

/**
 * Exact cost of a completed call. Input tokens are split three ways: cached
 * reads, cache writes, and the rest at the normal input rate. Missing cache
 * rates fall back to the normal input rate. Reasoning tokens are already part
 * of outputTokens, so they aren't added again.
 */
export function computeCostUsd(usage: ProviderUsage, pricing: ModelPricing): number {
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const writes = Math.min(usage.cacheWriteTokens, usage.inputTokens - cached);
  const regular = usage.inputTokens - cached - writes;
  const cost =
    regular * pricing.inputCostPerMtok +
    cached * (pricing.cachedInputCostPerMtok ?? pricing.inputCostPerMtok) +
    writes * (pricing.cacheWriteCostPerMtok ?? pricing.inputCostPerMtok) +
    usage.outputTokens * pricing.outputCostPerMtok;
  return roundUsd(cost * PER_TOKEN);
}

/** Default output ceiling for the budget estimate when a model row sets none. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4_000;

/**
 * Worst-case cost of a call before it is made, for the budget check:
 * a deliberately high input estimate (1 token per 3 characters, no cache
 * discount) plus the full output ceiling.
 */
export function estimateMaxCostUsd(
  inputChars: number,
  maxOutputTokens: number | null,
  pricing: ModelPricing,
): number {
  const inputTokens = Math.ceil(inputChars / 3);
  const outputTokens = maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const writeRate = Math.max(pricing.inputCostPerMtok, pricing.cacheWriteCostPerMtok ?? 0);
  return roundUsd((inputTokens * writeRate + outputTokens * pricing.outputCostPerMtok) * PER_TOKEN);
}

/** Matches the numeric(12, 6) columns. */
function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
