import { z } from "zod";
import { checkOriginalWording } from "@/lib/text/overlap";
import type { Generate } from "./types";

/**
 * Our own short description, written from the facts only: the source's
 * description is never in the prompt (plan section 5, rule 7). It's still
 * checked against the source description: sharing a run of 8+ words means
 * regenerate once, then hold it for review (AGENTS.md rule 4).
 *
 * No description beats one that restates the title or category (owner,
 * 2026-10-04). A description must add at least one fact the title and
 * category don't already say: a performer, an age or grade range, what
 * attendees do, or that registration is required. Code works out which of
 * those exist before calling the model (none means no call and no
 * description), the model names the ones it used, and code checks each one
 * actually appears in the text.
 */

export const DESCRIBE_PROMPT_VERSION = "describe@3";

export const ADDED_FACTS = ["performers", "ages", "activity", "registration"] as const;
export type AddedFact = (typeof ADDED_FACTS)[number];

export interface DescribeFacts {
  title: string;
  when: string;
  venue: string;
  city: string;
  category: string;
  price: string | null;
  tags: string[];
  // Only the facts the title doesn't already state (see newFacts).
  performers: string[];
  ages: string | null;
  activity: string | null;
  registrationRequired: boolean | null;
}

export type DescribeResult =
  | { status: "ok"; description: string; usedFacts: AddedFact[]; callId: string; model: string; attempts: number }
  | { status: "held"; sharedRun: string; callId: string; model: string; attempts: number }
  | { status: "none"; reason: string; callId: string | null; model: string | null; attempts: number };

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const numbers = (s: string) => new Set(s.match(/\d+/g) ?? []);

/** Performers whose name isn't already in the title. */
export function newPerformers(title: string, performers: readonly string[]): string[] {
  const t = ` ${norm(title)} `;
  return performers.filter((p) => norm(p) && !t.includes(` ${norm(p)} `));
}

/** "ages 6–12" or "grades 5–12", unless the title already gives those numbers. */
export function newAges(
  title: string,
  r: { ageMin: number | null; ageMax: number | null; gradeMin: number | null; gradeMax: number | null },
): string | null {
  const range = (label: string, min: number | null, max: number | null) =>
    min !== null && max !== null ? `${label} ${min}–${max}` : min !== null ? `${label} ${min} and up` : max !== null ? `${label} up to ${max}` : null;
  const text = range("ages", r.ageMin, r.ageMax) ?? range("grades", r.gradeMin, r.gradeMax);
  if (!text) return null;
  const inTitle = numbers(title);
  const stated = [...numbers(text)];
  return stated.some((n) => inTitle.has(n)) ? null : text;
}

// Verbs and filler that say nothing on their own: "watch a movie" adds
// nothing to "Family Movies", and "make a bracelet" nothing to "Bracelet Making".
const GENERIC = new Set([
  "and", "the", "for", "you", "are", "all", "our", "its", "any", "can", "but", "not", "who", "how", "out",
  "with", "from", "your", "their", "about", "into", "some", "them", "they", "will", "have", "people", "together", "other", "more",
  "watch", "make", "learn", "join", "enjoy", "take", "attend", "participate", "come", "see", "play", "get", "do", "meet", "spend", "time",
  "event", "program", "session", "class", "activity", "group",
]);
const stem = (w: string) => w.replace(/(ing|ed|es|s|e)$/, "").slice(0, 6);
const contentStems = (s: string) =>
  norm(s)
    .split(" ")
    .filter((w) => /^[a-z]{3,}$/.test(w) && !GENERIC.has(w))
    .map(stem);

/** The activity's words that the title and category don't already say. */
export function newActivityStems(activity: string | null, title: string, category: string): string[] {
  if (!activity) return [];
  const known = new Set(contentStems(`${title} ${category}`));
  return [...new Set(contentStems(activity).filter((w) => !known.has(w)))];
}

/** Which addable facts exist for this event. */
export function availableFacts(f: DescribeFacts): AddedFact[] {
  const out: AddedFact[] = [];
  if (f.performers.length) out.push("performers");
  if (f.ages) out.push("ages");
  if (newActivityStems(f.activity, f.title, f.category).length) out.push("activity");
  if (f.registrationRequired === true) out.push("registration");
  return out;
}

/** Whether `fact` really appears in the description, so "usedFacts" can't be a bluff. */
export function factAppears(fact: AddedFact, description: string, f: DescribeFacts): boolean {
  const d = ` ${norm(description)} `;
  switch (fact) {
    case "performers":
      return f.performers.some((p) => d.includes(` ${norm(p)} `));
    case "ages": {
      const inText = numbers(description);
      return [...numbers(f.ages ?? "")].some((n) => inText.has(n));
    }
    case "activity": {
      // At least one of the activity's new words must make it into the text.
      const inText = new Set(contentStems(description));
      return newActivityStems(f.activity, f.title, f.category).some((w) => inText.has(w));
    }
    case "registration":
      return /\b(regist|sign[ -]?up|reserv|rsvp)/.test(d);
  }
}

export function describeSchema(available: readonly AddedFact[]) {
  const facts = (available.length ? available : ADDED_FACTS) as readonly [AddedFact, ...AddedFact[]];
  return z.object({
    description: z.string().trim().min(20).max(320).nullable(),
    usedFacts: z.array(z.enum(facts)).max(ADDED_FACTS.length),
  });
}

export async function describeEvent(
  generate: Generate,
  facts: DescribeFacts,
  sourceDescription: string | null,
  runId?: string | null,
): Promise<DescribeResult> {
  const available = availableFacts(facts);
  if (available.length === 0) {
    return { status: "none", reason: "no fact beyond the title and category", callId: null, model: null, attempts: 0 };
  }
  let last: { callId: string; model: string } | null = null;
  let sharedRun = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await generate({
      task: "describe",
      schema: describeSchema(available),
      schemaName: "event_description",
      system: [
        "Write a description of a local event for a community calendar: one or two sentences, under 200 characters, plain and friendly, in English.",
        "The title, category, date, time, venue, and tags are shown next to your text. Your description must add at least one of these facts, and only from the facts given: " +
          available.join(", ") +
          ". Never restate the title or category, and don't start with \"Join\".",
        "Set usedFacts to the facts you included. If you can't add any of them, set description to null and usedFacts to [].",
        "Use only the facts given. Don't invent details, prices, ages, or times. Keep any title as published, even if it isn't in English.",
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
    const { description, usedFacts } = result.data;
    const verified = [...new Set(usedFacts)].filter((u) => available.includes(u) && description && factAppears(u, description, facts));
    if (!description || verified.length === 0) {
      return { status: "none", reason: "the model added no checkable fact", ...last, attempts: attempt };
    }
    const check = checkOriginalWording(description, sourceDescription);
    if (check.ok) return { status: "ok", description, usedFacts: verified, ...last, attempts: attempt };
    sharedRun = check.sharedRun ?? "";
  }
  return { status: "held", sharedRun, ...last!, attempts: 2 };
}
