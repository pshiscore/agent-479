/**
 * Normalizes a venue name or alias for exact comparison: "The Momentary" and
 * "momentary", or "Walton Arts Center" and "walton  arts center." compare
 * equal. Used by seed verification now and by the venue resolver later.
 */
export function normalizeVenueName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    // Drop apostrophes and periods in place, so "W.A.C." matches "WAC".
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "");
}

/** Every normalized name a venue answers to: its name plus its aliases. */
export function venueNameKeys(v: { name: string; aliases: readonly string[] }): string[] {
  return [...new Set([v.name, ...v.aliases].map(normalizeVenueName).filter(Boolean))];
}
