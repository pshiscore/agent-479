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

const words = (s: string) => new Set(s.split(" ").filter(Boolean));
const STATE_WORDS = new Set(["ar", "ark", "arkansas"]);

/**
 * Whether `inner`'s words appear whole inside `outer`. A one-word inner name
 * only counts when everything else is a state ("The Momentary - AR" contains
 * "momentary"), so a short alias like "FPL" doesn't swallow "FPL on Wheels
 * Bookmobile".
 */
function contains(outer: string, inner: string): boolean {
  if (!` ${outer} `.includes(` ${inner} `)) return false;
  if (inner.split(" ").length >= 2) return true;
  const rest = ` ${outer} `.replace(` ${inner} `, " ").trim().split(" ").filter(Boolean);
  return rest.every((w) => STATE_WORDS.has(w));
}

/**
 * Names "match closely" (for proposing links and resolving venues, never for
 * linking by itself) when, after normalization, they're equal, one's words
 * appear whole inside the other (see contains), or their words overlap by at
 * least 60%. Checked against the venue's name and aliases.
 */
export function namesMatchClosely(tmName: string | null, venue: { name: string; aliases: readonly string[] }): boolean {
  if (!tmName) return false;
  const t = normalizeVenueName(tmName);
  if (!t) return false;
  return venueNameKeys(venue).some((k) => {
    if (t === k || contains(t, k) || contains(k, t)) return true;
    const a = words(t);
    const b = words(k);
    const shared = [...a].filter((w) => b.has(w)).length;
    return shared / new Set([...a, ...b]).size >= 0.6;
  });
}


const STATE_SUFFIX = /^(ar|ark|arkansas)$/i;

/**
 * The room or hall a source's venue name points to inside our venue:
 * "Walton Arts Center - Baum Walker Hall" → "Baum Walker Hall". Null when the
 * name is just the venue (or the venue plus a state, like "The Momentary - AR").
 */
export function subSpaceName(tmName: string | null, venue: { name: string; aliases: readonly string[] }): string | null {
  if (!tmName) return null;
  // "Venue - Hall", "Venue – Hall", "Venue | Hall", or "Venue: Hall".
  const parts = tmName.split(/\s+[-–—|]\s+|\s*:\s+/);
  if (parts.length < 2) return null;
  const keys = venueNameKeys(venue);
  if (!keys.includes(normalizeVenueName(parts[0]))) return null;
  const rest = parts.slice(1).join(" - ").trim();
  return rest && !STATE_SUFFIX.test(rest) && !keys.includes(normalizeVenueName(rest)) ? rest : null;
}


const QUALIFIERS = new Set(["upper", "lower", "north", "south", "east", "west", "old", "new"]);

/**
 * Whether two names differ only by qualifier words: "Lower Ramble" and
 * "Upper Ramble", or "Lower Ramble" and "The Ramble". Such names are never a
 * match, at any resolver stage: they're different places that share a name.
 */
export function differsOnlyByQualifier(a: string, b: string): boolean {
  const x = words(normalizeVenueName(a));
  const y = words(normalizeVenueName(b));
  const diff = [...[...x].filter((w) => !y.has(w)), ...[...y].filter((w) => !x.has(w))];
  return diff.length > 0 && diff.length < x.size + y.size && diff.every((w) => QUALIFIERS.has(w));
}

/** True when a location name points at a qualified sibling of this venue rather than the venue itself. */
export function qualifierConflict(locName: string | null, venue: { name: string; aliases: readonly string[] }): boolean {
  if (!locName) return false;
  const key = normalizeVenueName(locName);
  const keys = venueNameKeys(venue);
  return !keys.includes(key) && keys.some((k) => differsOnlyByQualifier(key, k));
}
