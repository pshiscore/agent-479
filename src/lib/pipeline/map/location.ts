/**
 * Parses the location strings our feeds use:
 *   CivicPlus: "Rogers Historical Museum - 313 S 2nd St  Rogers AR 72756"
 *              (the name may carry HTML: "<p>Rogers Historical Museum</p> - ...")
 *   Communico: "Fayetteville Public Library - Walmart Story Time Room (1st Floor)"
 *   Ticketmaster: built from its venue fields.
 */

export interface ParsedLocation {
  text: string | null;
  name: string | null;
  room: string | null;
  street: string | null;
  city: string | null;
}

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

// The separator: a hyphen with whitespace or the string's edge on both sides,
// so "Baum-Walker" stays whole but "Name -", "- City", and "Name - x" split.
const SEPARATOR = /(?:^|\s)-(?:\s|$)/;
// "... AR" or "... AR 72756" at the end of the address part.
const STATE_ZIP = /\s*\bAR(?:\s+\d{5})?\s*$/;

export function parseLocation(raw: string | null): ParsedLocation {
  if (!raw) return { text: null, name: null, room: null, street: null, city: null };
  const text = stripHtml(raw) || null;
  // Drop tags but keep spacing: CivicPlus puts two spaces before the city.
  const cleaned = raw.replace(/<[^>]*>/g, "");
  const sep = SEPARATOR.exec(cleaned);
  const head = stripHtml(sep ? cleaned.slice(0, sep.index) : cleaned);
  const tail = sep ? cleaned.slice(sep.index + sep[0].length) : "";

  let street: string | null = null;
  let city: string | null = null;
  let room: string | null = null;
  if (STATE_ZIP.test(tail)) {
    // "313 S 2nd St  Rogers AR 72756" or "  Bentonville AR 72712".
    const parts = tail.replace(STATE_ZIP, "").split(/\s{2,}/).map((p) => stripHtml(p)).filter(Boolean);
    city = parts.pop() ?? null;
    street = parts.join(" ") || null;
  } else if (tail.trim()) {
    room = stripHtml(tail) || null;
  }
  return { text, name: head || null, room, street, city };
}

/**
 * The key that groups unmatched records by place, for venue proposals. Built
 * from the name and street, lowercased and stripped of punctuation. A location
 * with only a city (or nothing) gets a "nolocation:" key: those records wait in
 * needs_venue, but a bare city is never proposed as a venue.
 */
export function locationKey(loc: ParsedLocation): string {
  const norm = (s: string | null) =>
    (s ?? "")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const parts = [norm(loc.name), norm(loc.street)].filter(Boolean);
  if (parts.length === 0) return `nolocation:${norm(loc.city) || "unknown"}`;
  return [...parts, norm(loc.city)].filter(Boolean).join(" | ");
}
