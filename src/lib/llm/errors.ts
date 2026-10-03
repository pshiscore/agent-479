export type LlmErrorCode =
  | "no_active_model"
  | "unknown_provider"
  | "invalid_config"
  | "budget_exceeded"
  | "provider_error"
  | "refusal"
  | "incomplete"
  | "invalid_output";

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    /** The llm_calls row id, when the failed call was logged. */
    readonly callId?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LlmError";
  }
}
