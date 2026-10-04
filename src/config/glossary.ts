/**
 * Acronym expansions that count as facts (owner, 2026-10-04). Only the owner
 * adds entries: when the grounding check finds an expansion that isn't here,
 * it logs a propose_glossary for the owner's approval, and an approved entry
 * is added to this list by hand.
 *
 * An expansion counts as grounded only for an event whose own facts contain
 * the acronym (as a whole word, in capitals): "English" is grounded for an
 * "ESL" class, not for a concert.
 */
export interface GlossaryEntry {
  acronym: string;
  expansion: string;
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  { acronym: "ESL", expansion: "English as a Second Language" },
  { acronym: "GED", expansion: "General Educational Development" },
];
