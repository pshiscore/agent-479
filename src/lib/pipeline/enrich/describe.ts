import { z } from "zod";
import { checkOriginalWording } from "@/lib/text/overlap";
import type { Generate } from "./types";

/**
 * Our own short description, written from the facts only: the source's
 * description is never in the prompt (plan section 5, rule 7). It's still
 * checked against the source description: sharing a run of 8+ words means
 * regenerate once, then hold it for review (AGENTS.md rule 4).
 */

export const DESCRIBE_PROMPT_VERSION = "describe@2";
export const describeSchema = z.object({ description: z.string().trim().min(20).max(320) });

export interface DescribeFacts {
  title: string;
  when: string;
  venue: string;
  city: string;
  category: string;
  price: string | null;
  performers: string[];
  tags: string[];
  registrationRequired: boolean | null;
}

export type DescribeResult =
  | { status: "ok"; description: string; callId: string; model: string; attempts: number }
  | { status: "held"; sharedRun: string; callId: string; model: string; attempts: number };

export async function describeEvent(
  generate: Generate,
  facts: DescribeFacts,
  sourceDescription: string | null,
  runId?: string | null,
): Promise<DescribeResult> {
  let last: { callId: string; model: string } | null = null;
  let sharedRun = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await generate({
      task: "describe",
      schema: describeSchema,
      schemaName: "event_description",
      system: [
        "Write a description of a local event for a community calendar: one or two sentences, under 200 characters, plain and friendly.",
        "Use only the facts given. Don't invent details, prices, ages, or times that aren't listed.",
        "The title, date, time, and venue are shown next to your text, so don't repeat them, and don't start with \"Join\".",
        "Say what the event is and who it's for. If the facts are thin, one short sentence beats padding.",
        attempt > 1 ? "Write it entirely in your own words, with no phrasing borrowed from any listing." : null,
      ]
        .filter(Boolean)
        .join("\n"),
      // The facts JSON only: no source text reaches this prompt.
      input: JSON.stringify(facts, null, 2),
      promptVersion: DESCRIBE_PROMPT_VERSION,
      runId,
    });
    last = { callId: result.callId, model: result.model };
    const check = checkOriginalWording(result.data.description, sourceDescription);
    if (check.ok) return { status: "ok", description: result.data.description, ...last, attempts: attempt };
    sharedRun = check.sharedRun ?? "";
  }
  return { status: "held", sharedRun, ...last!, attempts: 2 };
}
