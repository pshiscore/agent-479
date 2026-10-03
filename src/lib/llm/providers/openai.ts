import OpenAI from "openai";
import { z } from "zod";
import { LlmError } from "../errors";
import type { LlmProvider, ProviderRequest, ProviderResponse } from "../types";

/** The llm_models.params keys this adapter understands. Anything else is a typo. */
const paramsSchema = z
  .object({
    reasoning_effort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]),
    temperature: z.number().min(0).max(2),
  })
  .partial()
  .strict();

export class OpenAIProvider implements LlmProvider {
  readonly name = "openai";

  constructor(private readonly client: OpenAI) {}

  static fromEnv(): OpenAIProvider {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new LlmError("provider_error", "OPENAI_API_KEY is not set");
    return new OpenAIProvider(new OpenAI({ apiKey, maxRetries: 2, timeout: 90_000 }));
  }

  validateParams(params: Record<string, unknown>): void {
    const result = paramsSchema.safeParse(params);
    if (!result.success) {
      throw new LlmError(
        "invalid_config",
        `Invalid openai params ${JSON.stringify(params)}: ${result.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
  }

  async generateJson(req: ProviderRequest): Promise<ProviderResponse> {
    const params = paramsSchema.parse(req.params);
    const response = await this.client.responses.create(
      {
        model: req.model,
        instructions: req.system,
        input: req.input,
        text: {
          format: { type: "json_schema", name: req.schemaName, schema: req.jsonSchema, strict: true },
        },
        ...(req.maxOutputTokens != null && { max_output_tokens: req.maxOutputTokens }),
        ...(params.reasoning_effort && { reasoning: { effort: params.reasoning_effort } }),
        ...(params.temperature != null && { temperature: params.temperature }),
        // We log everything ourselves; don't retain prompts (they hold third-party content).
        store: false,
      },
      { signal: req.signal },
    );

    const usage = response.usage;
    let refusal: string | undefined;
    for (const item of response.output) {
      if (item.type !== "message") continue;
      for (const part of item.content) if (part.type === "refusal") refusal = part.refusal;
    }

    return {
      text: response.output_text ?? "",
      usage: {
        inputTokens: usage?.input_tokens ?? 0,
        cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: usage?.input_tokens_details?.cache_write_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
      },
      refusal,
      incompleteReason:
        response.status === "incomplete"
          ? (response.incomplete_details?.reason ?? "unknown")
          : undefined,
    };
  }
}
