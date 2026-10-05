import { z } from "zod";
import type { Generate } from "@/lib/pipeline/enrich/types";
import { newActivityStems } from "@/lib/pipeline/enrich/describe";
import { contentIssues, describeIssues } from "@/lib/text/checks";
import type { PlaceSource } from "@/lib/db/schema";
import { PLACE_KIND_LABELS, PLACE_TYPE_LABELS, addressLine, openedLabel, targetLabel } from "./format";

/**
 * A place's short description (docs/product/front-page.md, H), written only
 * from facts the owner recorded from a source they checked (each source's
 * `facts`, in the owner's own words). The card already shows the name, type,
 * address, and date, so a description must add a stated fact beyond those;
 * with none, there's no model call and no description.
 *
 * Checks, as for events: no evaluative words, every proper name and number
 * grounded in the facts given, and every fact the model claims to use must
 * actually appear. A failure is regenerated once, then held.
 */

export const PLACE_DESCRIBE_PROMPT_VERSION = "place-describe@1";

export interface PlaceFacts {
  name: string;
  type: string;
  kind: string;
  address: string;
  city: string;
  when: string | null;
  /** Stated facts, each from an owner-verified source. */
  stated: string[];
}

type PlaceForFacts = {
  name: string;
  placeType: string;
  kind: string;
  address: string;
  addressKind: string;
  city: string;
  status: string;
  openedOn: string | null;
  openedPrecision: "day" | "month" | null;
  openedQualifier: string | null;
  targetOn: string | null;
  targetPrecision: "day" | "month" | null;
  targetQualifier: string | null;
  sources: PlaceSource[];
};

/** The facts the model may use: card facts plus each owner-verified source's stated facts. */
export function placeFacts(p: PlaceForFacts): PlaceFacts {
  const stated = p.sources.filter((s) => s.verifiedBy === "owner").flatMap((s) => s.facts ?? []);
  return {
    name: p.name,
    type: PLACE_TYPE_LABELS[p.placeType] ?? p.placeType,
    kind: PLACE_KIND_LABELS[p.kind] ?? p.kind,
    address: addressLine(p),
    city: p.city,
    when: openedLabel(p) ?? targetLabel(p),
    stated: [...new Set(stated.map((s) => s.trim()).filter(Boolean))],
  };
}

/** Stated facts that say something the name and type don't ("a bakery" adds nothing to a Bakery). */
export function addableFacts(f: PlaceFacts): string[] {
  return f.stated.filter((s) => newActivityStems(s, f.name, f.type).length > 0);
}

/** Whether a stated fact made it into the text: at least one of its new words appears. */
export function factUsed(fact: string, text: string, f: PlaceFacts): boolean {
  const inText = new Set(newActivityStems(text, "", ""));
  return newActivityStems(fact, f.name, f.type).some((w) => inText.has(w));
}

export type PlaceDescribeResult =
  | { status: "ok"; description: string; usedFacts: string[]; callId: string; model: string; attempts: number }
  | { status: "held"; problem: string; callId: string; model: string; attempts: number }
  | { status: "none"; reason: string; callId: string | null; model: string | null; attempts: number };

const schema = z.object({
  description: z.string().trim().min(20).max(320).nullable(),
  usedFacts: z.array(z.number().int().min(0)).max(10),
});

export async function describePlace(generate: Generate, facts: PlaceFacts): Promise<PlaceDescribeResult> {
  const addable = addableFacts(facts);
  if (addable.length === 0) return { status: "none", reason: "no stated fact beyond the name and type", callId: null, model: null, attempts: 0 };
  const checkFacts = { text: [facts.name, facts.type, facts.kind, facts.address, facts.city, facts.when, ...facts.stated].filter(Boolean).join(" | "), ownNames: [facts.name] };
  let last: { callId: string; model: string } | null = null;
  let problem = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await generate({
      task: "describe",
      schema,
      schemaName: "place_description",
      system: [
        "Write a short description of a newly opened local place for a community guide: one or two sentences, under 200 characters, plain and friendly, in English.",
        "The name, type, address, city, and opening date are shown next to your text. Add at least one of the numbered stated facts, and nothing that isn't in the facts given. Don't restate the name, type, address, or date on their own.",
        "Set usedFacts to the numbers of the stated facts you included. If you can't use any, set description to null and usedFacts to [].",
        "No menu items, dishes, ingredients, prices, hours, or features unless a stated fact says them. Don't invent anything.",
        "Report, don't judge: no opinions or praise (no \"best\", \"delicious\", \"must-try\"), no reviews or ratings, and no background beyond the facts given.",
        attempt > 1 ? `Your previous draft was rejected (${problem}). Write it again using only the facts given, with no praise.` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      // Owner-entered facts only: no fetched text reaches this prompt.
      input: JSON.stringify({ ...facts, stated: undefined, statedFacts: addable.map((text, i) => ({ number: i, text })) }, null, 2),
      promptVersion: PLACE_DESCRIBE_PROMPT_VERSION,
    });
    last = { callId: result.callId, model: result.model };
    const { description, usedFacts } = result.data;
    const used = [...new Set(usedFacts)].map((i) => addable[i]).filter((s): s is string => Boolean(s) && Boolean(description) && factUsed(s, description!, facts));
    if (!description || used.length === 0) return { status: "none", reason: "the model added no checkable fact", ...last, attempts: attempt };
    const issues = contentIssues(description, checkFacts);
    if (!issues) return { status: "ok", description, usedFacts: used, ...last, attempts: attempt };
    problem = describeIssues(issues);
  }
  return { status: "held", problem, ...last!, attempts: 2 };
}
