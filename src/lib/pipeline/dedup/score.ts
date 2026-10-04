import type { DedupScores } from "@/lib/db/schema";
import { DEDUP_THRESHOLDS } from "@/config/dedup";
import { normalizeVenueName } from "@/lib/venues/normalize";

/**
 * Pure scoring and deciding for duplicate detection (plan section 6, rules 3
 * and 4). No database, no model: the regression test (step 17) runs exactly
 * this code on the owner's labeled pairs.
 *
 * score = max(trigram similarity, token-set ratio) of the normalized titles.
 * A matching Ticketmaster event ID is certain. Thresholds start as
 * placeholders and are set from the owner's labels in step 17.
 */

export const T_MERGE = DEDUP_THRESHOLDS.tMerge;
export const T_LLM = DEDUP_THRESHOLDS.tLlm;
export const MERGE_MAX_START_DIFF_MIN = 30;
export const LLM_SAME_MIN_CONFIDENCE = 0.8;

export interface PairSide {
  title: string;
  startAt: Date;
  ticketUrl: string | null;
  sourceUrl: string | null;
  subSpace?: string | null;
}

/** Titles as compared: the venue-name normalizer (lowercase, unaccented, punctuation-free, no leading "the"). */
export const normalizeTitle = (t: string) => normalizeVenueName(t);

/** pg_trgm's trigrams: each word padded with two spaces before and one after. */
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of s.split(" ").filter(Boolean)) {
    const w = `  ${word} `;
    for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3));
  }
  return out;
}

/** pg_trgm similarity(): shared trigrams over all distinct trigrams. */
export function trigramSimilarity(a: string, b: string): number {
  const x = trigrams(normalizeTitle(a));
  const y = trigrams(normalizeTitle(b));
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / (x.size + y.size - shared);
}

/**
 * Token-set score, at the word level: the letters in the words both titles
 * share, over the letters in the shorter title's words. Word order and extra
 * words don't count against a match ("Ziggy Marley" vs "Ziggy Marley - One
 * Love Tour" is 1), but one shared word doesn't make two events the same
 * ("Harvest Market" vs "Harvest Dance" is 0.58). Misspellings are the trigram
 * score's job. (A character-level ratio, as in fuzzywuzzy, scored that pair
 * 0.85, enough to merge.)
 */
export function tokenSetRatio(a: string, b: string): number {
  const x = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const y = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (x.size === 0 || y.size === 0) return 0;
  const letters = (words: Iterable<string>) => [...words].reduce((n, w) => n + w.length, 0);
  const shared = letters([...x].filter((w) => y.has(w)));
  return shared / Math.min(letters(x), letters(y));
}

/** A Ticketmaster event ID in a ticketmaster.com event link ("/event/0C00630FD8A54C2E"). */
export function ticketmasterEventId(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/(^|\.)ticketmaster\.com$/i.test(u.hostname)) return null;
    return /\/event\/([A-Za-z0-9]+)/.exec(u.pathname)?.[1]?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function scorePair(a: PairSide, b: PairSide): Omit<DedupScores, "llm"> {
  const tmA = ticketmasterEventId(a.ticketUrl) ?? ticketmasterEventId(a.sourceUrl);
  const tmB = ticketmasterEventId(b.ticketUrl) ?? ticketmasterEventId(b.sourceUrl);
  const ticketmasterIdMatch = !!tmA && tmA === tmB;
  const trigram = round(trigramSimilarity(a.title, b.title));
  const tokenSet = round(tokenSetRatio(a.title, b.title));
  const title = Math.max(trigram, tokenSet);
  const subSpaceDiffers = !!a.subSpace && !!b.subSpace && normalizeTitle(a.subSpace) !== normalizeTitle(b.subSpace);
  return {
    subSpaceDiffers,
    title,
    trigram,
    tokenSet,
    startDiffMinutes: Math.round(Math.abs(a.startAt.getTime() - b.startAt.getTime()) / 60_000),
    ticketmasterIdMatch,
    score: ticketmasterIdMatch ? 1 : title,
    tMerge: T_MERGE,
    tLlm: T_LLM,
  };
}

export type PreDecision = "auto_merge" | "llm" | "distinct";

/**
 * Rule 4. A high title score goes to the tiebreak rather than merging when
 * the starts are more than 30 minutes apart (two showings the same evening),
 * or when both name a room and the rooms differ (two groups at once, or a
 * listing left behind after a room change: the model sees both rooms).
 */
export function preDecide(
  s: Pick<DedupScores, "score" | "startDiffMinutes" | "ticketmasterIdMatch" | "subSpaceDiffers">,
  t = { merge: T_MERGE, llm: T_LLM },
): PreDecision {
  if (s.ticketmasterIdMatch) return "auto_merge";
  if (s.score >= t.merge && s.startDiffMinutes <= MERGE_MAX_START_DIFF_MIN && !s.subSpaceDiffers) return "auto_merge";
  if (s.score >= t.llm) return "llm";
  return "distinct";
}

/** The tiebreak's answer, turned into a decision. */
export function decideFromLlm(llm: { same: boolean; confidence: number }): "llm_same" | "uncertain" | "distinct" {
  if (!llm.same) return "distinct";
  return llm.confidence >= LLM_SAME_MIN_CONFIDENCE ? "llm_same" : "uncertain";
}
