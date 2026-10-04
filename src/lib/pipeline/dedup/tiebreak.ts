import { z } from "zod";
import { wrapUntrusted } from "@/lib/llm";
import { formatInChicago } from "@/lib/time";
import type { Generate } from "../enrich/types";

/**
 * The LLM tiebreak for pairs between T_llm and T_merge (plan section 6, rule
 * 4): facts only, never source descriptions. Titles come from sources, so they
 * go inside the untrusted block. The model answers same/different with a
 * confidence; code decides what that means (decideFromLlm).
 */

export const DEDUP_PROMPT_VERSION = "dedup@1";
export const tiebreakSchema = z.object({ same: z.boolean(), confidence: z.number().min(0).max(1) });

export interface TiebreakSide {
  title: string;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  timeTba: boolean;
  venue: string;
  source: string;
  performers: string[];
}

const when = (s: TiebreakSide) =>
  s.allDay || s.timeTba
    ? `${formatInChicago(s.startAt, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${s.timeTba ? " (time to be announced)" : " (all day)"}`
    : `${formatInChicago(s.startAt, { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}${s.endAt ? ` to ${formatInChicago(s.endAt, { hour: "numeric", minute: "2-digit" })}` : ""}`;

const describe = (label: string, s: TiebreakSide) =>
  [`${label}:`, `  When: ${when(s)}`, `  Venue: ${s.venue}`, `  Listed by: ${s.source}`, s.performers.length ? `  Performers: ${s.performers.join(", ")}` : null]
    .filter(Boolean)
    .join("\n");

export async function tiebreak(generate: Generate, a: TiebreakSide, b: TiebreakSide, runId?: string | null) {
  const result = await generate({
    task: "dedup_tiebreak",
    schema: tiebreakSchema,
    schemaName: "dedup_tiebreak",
    system: [
      "Two listings from a local events calendar share a venue and start close together. Decide whether they are the same event (one occurrence listed twice) or different events.",
      "Different showings, sessions, or age groups at different times are different events. A program and a separate event that happens to share words in the title are different events.",
      "Answer same=true only when they are the same occurrence. Set confidence from 0 to 1. When unsure, answer with low confidence rather than guessing.",
    ].join("\n"),
    input: [describe("Listing A", a), describe("Listing B", b), wrapUntrusted("listing titles", `A: ${a.title}\nB: ${b.title}`, 600)].join("\n\n"),
    promptVersion: DEDUP_PROMPT_VERSION,
    runId,
  });
  return { data: result.data, callId: result.callId, model: result.model };
}
