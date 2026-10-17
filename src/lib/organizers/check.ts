/**
 * Pure helpers for checking an organizer against its own home page
 * (scripts/check-organizers.ts). Nothing from the page is stored except
 * whether it names the organizer and the address of its events page.
 */

export type CheckOutcome = "confirmed" | "not_confirmed" | "blocked" | "robots_disallowed" | "unreachable" | "not_fetched";

export interface CheckAttempt {
  url: string;
  result: "confirmed" | "name_not_found" | "blocked" | "robots_disallowed" | "unreachable" | "not_html";
  detail?: string;
}

export interface OrganizerCheck {
  outcome: CheckOutcome;
  // The page that named the organizer (after redirects).
  website: string | null;
  // A link on that page to its events or calendar page, same site only.
  eventsPage: string | null;
  tried: CheckAttempt[];
  note?: string;
}

export interface CheckFile {
  checkedAt: string; // YYYY-MM-DD
  results: Record<string, OrganizerCheck>;
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", ndash: "-", mdash: "-", "#39": "'", "#039": "'", "#8217": "'" };

/** The page's visible text and title, lowercased, with entities decoded and whitespace collapsed. */
export function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&([a-z]+|#\d+);/gi, (m, e: string) => ENTITIES[e.toLowerCase()] ?? " ")
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Every word (or phrase) appears in the page text. */
export function namesOrganizer(text: string, words: readonly string[]): boolean {
  return words.length > 0 && words.every((w) => text.includes(w.toLowerCase()));
}

/** The main words of a name, when the seed gives none: drops articles and legal suffixes. */
export function defaultNameWords(name: string): string[] {
  const stop = new Set(["the", "of", "and", "inc", "inc.", "co", "co.", "company", "llc", "&"]);
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[,.;:]+$/, ""))
    .filter((w) => w && !stop.has(w));
}

// Strongest first: an "events" or "calendar" link beats "shows" or "programs".
const EVENTS_WORDS = [/\b(events?|calendar)\b/i, /\b(shows|concerts|programs)\b/i];
// Rentals, bookings, and news items aren't the public events page.
const NOT_EVENTS = /\b(private|rentals?|rent|book|booking|space|wedding|weddings|venue|consulting|civicalerts|news|tickets? policy)\b/i;

const sameSite = (a: URL, b: URL) => a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");

/** The first same-site link whose address or text says events or calendar (then shows, concerts, or programs). */
export function eventsLink(html: string, pageUrl: string): string | null {
  for (const words of EVENTS_WORDS) {
    const found = firstLink(html, pageUrl, words);
    if (found) return found;
  }
  return null;
}

function firstLink(html: string, pageUrl: string, words: RegExp): string | null {
  const base = new URL(pageUrl);
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].replace(/&amp;/g, "&");
    const inner = m[2];
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || !sameSite(u, base)) continue;
    const text = inner.replace(/<[^>]+>/g, " ");
    const path = u.pathname.replace(/[-_/.]/g, " ");
    if (NOT_EVENTS.test(path) || NOT_EVENTS.test(text)) continue;
    if (words.test(path) || words.test(text)) return u.toString();
  }
  return null;
}
