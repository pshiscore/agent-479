import { EVALUATIVE_TERMS } from "@/config/content-rules";
import { GLOSSARY, type GlossaryEntry } from "@/config/glossary";

/**
 * Checks on text the model writes for readers (AGENTS.md, "Content rules").
 * Both are pure, so they run at generation time and over stored text alike.
 *
 * - evaluativeTerms: words like "best" or "must-see". The event's own names
 *   (title, venue, performers) are removed first, so they never count.
 * - ungrounded: proper names and numbers in the text that don't appear in the
 *   facts we gave the model. That's how background from the model's own
 *   knowledge ("Grammy-winning", "since 1998") shows up.
 */

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[’‘]/g, "'")
    .toLowerCase();

const termPattern = (term: string) =>
  new RegExp(`(^|[^a-z0-9])${fold(term).replace(/[-' ]+/g, "[-' ]*").replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "[" || c === "]" || c === "*" ? c : `\\${c}`))}($|[^a-z0-9])`, "i");

/** Removes each name (case-insensitive, whole occurrences) from the text. */
function withoutNames(text: string, names: readonly string[]): string {
  let out = fold(text);
  for (const n of names.map(fold).filter((n) => n.trim().length > 1).sort((a, b) => b.length - a.length)) {
    out = out.split(n).join(" ");
  }
  return out;
}

export function evaluativeTerms(text: string, ownNames: readonly string[], terms: readonly string[] = EVALUATIVE_TERMS): string[] {
  const t = withoutNames(text, ownNames);
  return terms.filter((term) => termPattern(term).test(t));
}

// Capitalized words that aren't names or are always fine in a summary.
const NOT_NAMES = new Set([
  "i", "a", "an", "the", "and", "or", "for", "with", "at", "in", "on", "of", "to", "by", "from", "this", "that", "these", "those",
  "ages", "age", "grades", "grade", "free", "registration", "kids", "teens", "adults", "families", "all",
  "am", "pm", "a.m", "p.m",
  "dr", "mr", "mrs", "ms", "jr", "sr",
]);

const words = (s: string) => fold(s).split(/[^a-z0-9+]+/).filter(Boolean);

/**
 * Proper names and numbers in `text` that aren't in `facts` (all the facts
 * the model was given, joined). A capitalized word counts as a name unless it
 * starts a sentence (then only acronyms and mixed-case words like "iPhone"
 * count: without a dictionary, "Grammy-winning" at the very start of a
 * sentence looks like any sentence opener). Numbers count as written in digits.
 */
/** Acronyms written in capitals, as whole words, in the given text. */
const acronymsIn = (s: string) => new Set(s.match(/\b[A-Z]{2,6}\b/g) ?? []);

/** Glossary expansions whose acronym appears in the facts: their words count as known. */
export function groundedExpansions(facts: string, glossary: readonly GlossaryEntry[] = GLOSSARY): GlossaryEntry[] {
  const present = acronymsIn(facts);
  return glossary.filter((g) => present.has(g.acronym));
}

const SMALL_WORDS = new Set(["a", "an", "as", "of", "the", "and", "for", "in", "on", "to", "with"]);

/**
 * Phrases in `text` that spell out an acronym from the facts, aren't in the
 * glossary, and aren't grounded by other facts ("Test of English as a Foreign
 * Language" for "TOEFL"): candidates for the owner to add. Initials of
 * capitalized words; small words may supply a letter or be skipped.
 */
export function unknownExpansions(text: string, facts: string, glossary: readonly GlossaryEntry[] = GLOSSARY): GlossaryEntry[] {
  const known = new Set(glossary.map((g) => g.acronym));
  const wanted = [...acronymsIn(facts)].filter((a) => !known.has(a));
  if (wanted.length === 0) return [];
  const tokens = text.match(/[\p{L}][\p{L}'’-]*/gu) ?? [];
  const out: GlossaryEntry[] = [];
  // From token j, can the rest of the acronym be spelled? A capitalized word
  // must supply the next letter; a small word ("of", "as") may supply it
  // (TOEFL's "O") or be skipped (ESL's "as a").
  const spell = (j: number, rest: string): number | null => {
    if (rest === "") return j;
    if (j >= tokens.length) return null;
    const w = tokens[j];
    if (SMALL_WORDS.has(w.toLowerCase())) {
      if (w[0].toUpperCase() === rest[0]) {
        const used = spell(j + 1, rest.slice(1));
        if (used !== null) return used;
      }
      return spell(j + 1, rest);
    }
    if (!/^\p{Lu}/u.test(w) || w[0] !== rest[0]) return null;
    return spell(j + 1, rest.slice(1));
  };
  for (const acronym of wanted) {
    for (let i = 0; i < tokens.length; i++) {
      if (!/^\p{Lu}/u.test(tokens[i]) || tokens[i][0] !== acronym[0] || SMALL_WORDS.has(tokens[i].toLowerCase())) continue;
      const end = spell(i, acronym);
      if (end !== null) out.push({ acronym, expansion: tokens.slice(i, end).join(" ") });
    }
  }
  // Only expansions the grounding check would flag: one already grounded by
  // other facts (a venue named "Fayetteville Public Library") isn't proposed.
  return out.filter((c) => ungrounded(c.expansion, facts, glossary).length > 0);
}

export function ungrounded(text: string, facts: string, glossary: readonly GlossaryEntry[] = GLOSSARY): string[] {
  const known = new Set([...words(facts), ...groundedExpansions(facts, glossary).flatMap((g) => words(g.expansion))]);
  const knownNumbers = new Set(fold(facts).match(/\d+/g) ?? []);
  const out = new Set<string>();
  for (const n of text.match(/\d+/g) ?? []) if (!knownNumbers.has(n)) out.add(n);
  // A period after a title or street abbreviation ("Dr. Seuss", "St. Paul") doesn't end a sentence.
  const sentences = text.split(/(?<!\b(?:Dr|Mr|Mrs|Ms|St|Jr|Sr|Mt|Ave|vs|No)\.)(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    // Letters and digits stay together, so "3D" is one token (not a name: it doesn't start with a capital letter).
    const tokens = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’+-]*/gu) ?? [];
    tokens.forEach((tok, i) => {
      if (!/^\p{Lu}/u.test(tok)) return;
      const acronymOrMixed = /^\p{Lu}{2,}/u.test(tok) || /\p{Ll}\p{Lu}/u.test(tok);
      if (i === 0 && !acronymOrMixed) return;
      const parts = words(tok);
      if (parts.length === 0 || parts.every((p) => NOT_NAMES.has(p))) return;
      if (parts.every((p) => known.has(p) || NOT_NAMES.has(p))) return;
      out.add(tok.replace(/['’]s$/, ""));
    });
  }
  return [...out];
}

export interface ContentIssues {
  evaluative: string[];
  ungrounded: string[];
}

export function contentIssues(text: string, facts: { text: string; ownNames: readonly string[] }): ContentIssues | null {
  const evaluative = evaluativeTerms(text, facts.ownNames);
  const missing = ungrounded(text, facts.text);
  return evaluative.length || missing.length ? { evaluative, ungrounded: missing } : null;
}

export function describeIssues(i: ContentIssues): string {
  return [
    i.evaluative.length ? `evaluative: ${i.evaluative.join(", ")}` : null,
    i.ungrounded.length ? `not in the facts: ${i.ungrounded.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("; ");
}
