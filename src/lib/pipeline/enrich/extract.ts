import { z } from "zod";
import { wrapUntrusted } from "@/lib/llm";
import type { Facts } from "../map";
import type { Generate } from "./types";

/**
 * Facts the source states only in its description: price, free, age limit,
 * family-friendly, registration. Never URLs or IDs (code sets those), never
 * wording: these are values, not text. Only runs when there's a description.
 */
export const extractionSchema = z.object({
  isFree: z.boolean().nullable(),
  priceMin: z.number().min(0).max(10_000).nullable(),
  priceMax: z.number().min(0).max(10_000).nullable(),
  ageRestriction: z.enum(["all_ages", "18_plus", "21_plus"]).nullable(),
  familyFriendly: z.boolean().nullable(),
  registrationRequired: z.boolean().nullable(),
});
export type Extraction = z.infer<typeof extractionSchema>;

export const EXTRACT_PROMPT_VERSION = "extract@1";

export async function extractFacts(
  generate: Generate,
  facts: Facts,
  description: string,
  runId?: string | null,
): Promise<{ data: Extraction; callId: string; model: string }> {
  const result = await generate({
    task: "extract",
    schema: extractionSchema,
    schemaName: "event_extraction",
    system: [
      "Read an event's listing and report only facts it states explicitly.",
      "- isFree: true only if it says the event is free; false if it states a price; otherwise null.",
      "- priceMin/priceMax: ticket prices in US dollars as numbers, if stated; otherwise null.",
      "- ageRestriction: all_ages, 18_plus, or 21_plus only if stated; otherwise null.",
      "- familyFriendly: true only if it says it's for families or children; otherwise null.",
      "- registrationRequired: true if it says registration, sign-up, or tickets are required in advance; false if it says no registration is needed; otherwise null.",
    ].join("\n"),
    input: `Event title: ${facts.title}\n\n${wrapUntrusted("event listing", description, 4_000)}`,
    promptVersion: EXTRACT_PROMPT_VERSION,
    runId,
  });
  const d = result.data;
  // Contradictions resolve conservatively: a stated price beats "free".
  const priced = (d.priceMin ?? 0) > 0 || (d.priceMax ?? 0) > 0;
  const data: Extraction = {
    ...d,
    isFree: priced ? false : d.isFree,
    priceMax: d.priceMin !== null && d.priceMax !== null && d.priceMax < d.priceMin ? d.priceMin : d.priceMax,
  };
  return { data, callId: result.callId, model: result.model };
}
