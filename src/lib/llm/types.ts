/** Token usage as reported by a provider, normalized. */
export interface ProviderUsage {
  /** All input tokens, including cached and cache-write tokens. */
  inputTokens: number;
  /** Input tokens served from the prompt cache. */
  cachedInputTokens: number;
  /** Input tokens written to the prompt cache (billed at the cache-write rate). */
  cacheWriteTokens: number;
  /** All output tokens, including reasoning tokens. */
  outputTokens: number;
  /** The reasoning share of outputTokens (informational, already included). */
  reasoningTokens: number;
}

export interface ProviderRequest {
  model: string;
  system: string;
  input: string;
  /** Strict JSON Schema the output must match. */
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  /** Provider-specific params from llm_models.params. */
  params: Record<string, unknown>;
  maxOutputTokens: number | null;
  signal?: AbortSignal;
}

export interface ProviderResponse {
  /** The raw JSON text the model produced (may be empty on refusal). */
  text: string;
  usage: ProviderUsage;
  /** Set when the model declined to answer. */
  refusal?: string;
  /** Set when generation stopped early (e.g. max_output_tokens). */
  incompleteReason?: string;
}

/**
 * One adapter per provider. Adapters only translate requests and responses:
 * no retries on bad output, no logging, no budget logic (the wrapper owns those).
 */
export interface LlmProvider {
  readonly name: string;
  /** Throws if params contain keys this provider doesn't understand. */
  validateParams(params: Record<string, unknown>): void;
  generateJson(req: ProviderRequest): Promise<ProviderResponse>;
}
