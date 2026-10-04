/**
 * Street addresses, normalized for comparison: "5079 West Northgate Road," →
 * "5079 w northgate rd". Shared by the venue verifier and Ticketmaster matching.
 */

const STREET_WORDS: Record<string, string> = {
  street: "st", drive: "dr", road: "rd", avenue: "ave", boulevard: "blvd", lane: "ln", place: "pl",
  parkway: "pkwy", court: "ct", circle: "cir", highway: "hwy", trail: "trl", terrace: "ter",
  north: "n", south: "s", east: "e", west: "w", northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
};
const DIRECTIONS = new Set(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);
const TYPES = new Set(["st", "dr", "rd", "ave", "blvd", "ln", "pl", "pkwy", "ct", "cir", "hwy", "trl", "ter", "way", "loop", "sq"]);

export function normalizeStreetAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_WORDS[w] ?? w)
    .join(" ");
}

export interface StreetParts {
  number: string | null;
  direction: string | null;
  name: string;
  type: string | null;
}

/** "449 S Garland Ave" → { number: "449", direction: "s", name: "garland", type: "ave" }. */
export function streetParts(address: string): StreetParts {
  const words = normalizeStreetAddress(address).split(" ");
  const number = /^\d+[a-z]?$/.test(words[0] ?? "") ? words.shift()! : null;
  const direction = words.length > 1 && DIRECTIONS.has(words[0]) ? words.shift()! : null;
  const type = words.length > 1 && TYPES.has(words.at(-1)!) ? words.pop()! : null;
  return { number, direction, name: words.join(" "), type };
}

/**
 * How two addresses name different streets, or null if they agree. A missing
 * direction or type on one side isn't a difference ("Promenade Blvd" vs
 * "S Promenade Blvd"); a different one is ("S 56th St" vs "N 56th St").
 */
export function streetDifference(ours: string, theirs: string): string | null {
  const a = streetParts(ours);
  const b = streetParts(theirs);
  const diffs: string[] = [];
  if (a.name !== b.name) diffs.push(`street name "${a.name}" vs "${b.name}"`);
  if (a.type && b.type && a.type !== b.type) diffs.push(`street type "${a.type}" vs "${b.type}"`);
  if (a.direction && b.direction && a.direction !== b.direction) diffs.push(`direction "${a.direction}" vs "${b.direction}"`);
  return diffs.length ? diffs.join(", ") : null;
}

/**
 * Whether two addresses name the same street address, for proposing links
 * (never for linking by itself). House number and street name must match.
 * A directional on one side only is fine ("3615 Steele Blvd" = "3615 N Steele
 * Blvd"); different directionals never match ("3000 N 56th St" ≠ "3000 S 56th
 * St"). A street type on one side only is fine; different types don't match.
 * The caller checks the city.
 */
export function sameStreetAddress(a: string, b: string): boolean {
  const x = streetParts(a);
  const y = streetParts(b);
  if (!x.number || x.number !== y.number || x.name !== y.name) return false;
  if (x.direction && y.direction && x.direction !== y.direction) return false;
  if (x.type && y.type && x.type !== y.type) return false;
  return true;
}
