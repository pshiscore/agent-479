import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import type { ProviderRequest } from "../types";
import { OpenAIProvider } from "./openai";

type Captured = { url: string; body: Record<string, unknown> };

/** A real SDK client whose HTTP layer returns a canned Responses API payload. */
function providerReturning(payload: Record<string, unknown>) {
  const captured: Captured[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new OpenAI({ apiKey: "test-key", fetch, maxRetries: 0 });
  return { provider: new OpenAIProvider(client), captured };
}

const message = (content: unknown[]) => ({
  type: "message",
  id: "msg_1",
  role: "assistant",
  status: "completed",
  content,
});

const completed = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  id: "resp_1",
  object: "response",
  created_at: 0,
  status: "completed",
  model: "gpt-6-luna",
  output: [message(content)],
  usage: {
    input_tokens: 1200,
    input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 0 },
    output_tokens: 150,
    output_tokens_details: { reasoning_tokens: 90 },
    total_tokens: 1350,
  },
  ...extra,
});

const request: ProviderRequest = {
  model: "gpt-6-luna",
  system: "Extract the event.",
  input: "<<<UNTRUSTED-abc>>>Jazz Night<<<END UNTRUSTED-abc>>>",
  jsonSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false },
  schemaName: "event_facts",
  params: { reasoning_effort: "low" },
  maxOutputTokens: 4000,
};

describe("OpenAIProvider", () => {
  it("sends a strict JSON-schema Responses request and maps usage", async () => {
    const { provider, captured } = providerReturning(
      completed([{ type: "output_text", text: '{"title":"Jazz Night"}', annotations: [] }]),
    );
    const res = await provider.generateJson(request);

    expect(captured[0].url).toMatch(/\/responses$/);
    expect(captured[0].body).toMatchObject({
      model: "gpt-6-luna",
      instructions: "Extract the event.",
      input: request.input,
      max_output_tokens: 4000,
      reasoning: { effort: "low" },
      store: false,
      text: { format: { type: "json_schema", name: "event_facts", strict: true, schema: request.jsonSchema } },
    });
    expect(captured[0].body).not.toHaveProperty("temperature");

    expect(res).toEqual({
      text: '{"title":"Jazz Night"}',
      usage: { inputTokens: 1200, cachedInputTokens: 1000, cacheWriteTokens: 0, outputTokens: 150, reasoningTokens: 90 },
      refusal: undefined,
      incompleteReason: undefined,
    });
  });

  it("reports refusals", async () => {
    const { provider } = providerReturning(completed([{ type: "refusal", refusal: "I can't help with that." }]));
    expect((await provider.generateJson(request)).refusal).toBe("I can't help with that.");
  });

  it("reports incomplete output (e.g. hit max_output_tokens)", async () => {
    const { provider } = providerReturning(
      completed([{ type: "output_text", text: '{"tit', annotations: [] }], {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      }),
    );
    expect((await provider.generateJson(request)).incompleteReason).toBe("max_output_tokens");
  });

  it("rejects params it doesn't understand", () => {
    const { provider } = providerReturning({});
    expect(() => provider.validateParams({ reasoning_effort: "low" })).not.toThrow();
    expect(() => provider.validateParams({ reasoning_efort: "low" })).toThrow(/Invalid openai params/);
    expect(() => provider.validateParams({ reasoning_effort: "extreme" })).toThrow();
  });
});
