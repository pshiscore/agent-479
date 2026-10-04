/**
 * Content rules config (AGENTS.md, "Content rules"; owner, 2026-10-04).
 * Evaluative words and phrases that generated text must not contain. Matched
 * case-insensitively as whole words; hyphens, spaces, and apostrophes are
 * interchangeable ("must-see" = "must see"). The event's own title, venue, and
 * performer names are never checked, so "Best of Broadway" passes.
 */
export const EVALUATIVE_TERMS = [
  "best",
  "must-see",
  "don't miss",
  "amazing",
  "incredible",
  "legendary",
  "iconic",
  "world-class",
  "unforgettable",
] as const;
