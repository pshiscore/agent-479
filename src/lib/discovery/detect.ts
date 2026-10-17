import type { DiscoverySample } from "@/lib/db/schema";
import { jsonLdEventObjects } from "@/lib/sources/jsonld";
import { parseIcs } from "@/lib/sources/ics";
import { decodeEntities } from "@/lib/text/entities";

/**
 * Pure helpers for feed discovery (docs/product/organizers.md, step 6): what
 * an organizer's pages say about where its events are published. Pages are
 * untrusted data: only addresses and a few facts per sample event (title,
 * start, place) come out, never descriptions.
 */

export interface PageSignals {
  civicplus: boolean;
  eventsCalendarPlugin: boolean;
  squarespace: boolean;
  revize: boolean;
  // <link rel="alternate"> calendar and feed links.
  alternates: { href: string; type: string; title: string }[];
  // .ics and webcal: links, and The Events Calendar's ?ical=1 links.
  icsLinks: string[];
  libcalLinks: string[];
  googleCalendarIds: string[];
  termsLink: string | null;
}

export { decodeEntities } from "@/lib/text/entities";

const attr = (tag: string, name: string) => {
  const v = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
  return v === undefined ? null : decodeEntities(v);
};

const resolve = (href: string, base: string) => {
  try {
    const u = new URL(href.replace(/^webcal:/i, "https:"), base);
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
};

const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];

const TERMS_LINK = /\b(terms( of (use|service))?|legal|disclaimer|site policies|website policies|conditions of use)\b/i;

export function pageSignals(html: string, pageUrl: string): PageSignals {
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({ href: attr(m[1], "href"), text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }));
  const alternates = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((t) => /\brel\s*=\s*["']alternate["']/i.test(t) && /\btype\s*=\s*["'](text\/calendar|application\/(rss|atom)\+xml)["']/i.test(t))
    .map((t) => ({ href: resolve(attr(t, "href") ?? "", pageUrl), type: attr(t, "type") ?? "", title: (attr(t, "title") ?? "").trim() }))
    .filter((a): a is { href: string; type: string; title: string } => !!a.href);
  const hrefs = anchors.map((a) => a.href).filter((h): h is string => !!h);
  const iframes = [...html.matchAll(/<iframe\b[^>]*>/gi)].map((m) => attr(m[0], "src") ?? "");
  const google = [...hrefs, ...iframes]
    .filter((h) => /calendar\.google\.com\/calendar\/(embed|ical)/i.test(h))
    .map((h) => {
      try {
        const u = new URL(h, pageUrl);
        return u.searchParams.get("src") ?? /\/ical\/([^/]+)\//.exec(u.pathname)?.[1] ?? null;
      } catch {
        return null;
      }
    });
  const terms = anchors.find((a) => a.href && (TERMS_LINK.test(a.text) || /terms|legal|disclaimer/i.test(a.href)) && !/^privacy/i.test(a.text));
  return {
    civicplus: /civicplus|\/common\/modules\/|\/iCalendar\.aspx/i.test(html),
    eventsCalendarPlugin: /tribe-events|\/plugins\/the-events-calendar\//i.test(html),
    squarespace: /static1\.squarespace\.com|<!-- This is Squarespace\. -->/i.test(html),
    revize: /revize/i.test(html),
    alternates,
    icsLinks: uniq(hrefs.filter((h) => /^webcal:|\.ics(\?|$)|[?&]ical=1\b/i.test(h)).map((h) => resolve(h, pageUrl))),
    libcalLinks: uniq(hrefs.filter((h) => /\.libcal\.com\//i.test(h)).map((h) => resolve(h, pageUrl))),
    googleCalendarIds: uniq(google),
    termsLink: terms?.href ? resolve(terms.href, pageUrl) : null,
  };
}

/** A CivicPlus /iCalendar.aspx page: each calendar's id, name, and feed address. */
export function civicPlusFeeds(html: string, pageUrl: string): { catId: number; name: string; url: string }[] {
  const out = new Map<number, { catId: number; name: string; url: string }>();
  const generic = /^(subscribe|download|ical|rss|notify me|calendar|view|export|\W*)$/i;
  // Each calendar's feed link carries catID=N; its name is the link text (CivicPlus lists them as
  // <li><a href="...catID=32&feed=calendar">Holidays and Community Events</a></li>), else the nearest text before it.
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']*iCalendar\.aspx\?[^"']*catID=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const catId = Number(m[2]);
    if (out.has(catId)) continue;
    const own = decodeEntities(m[3].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const before = html.slice(Math.max(0, m.index - 600), m.index);
    const texts = [...before.matchAll(/>([^<>]{2,80})</g)].map((t) => decodeEntities(t[1]).replace(/\s+/g, " ").trim()).filter((t) => t && !generic.test(t));
    const name = own && !generic.test(own) ? own : texts.at(-1);
    if (name) out.set(catId, { catId, name: name.slice(0, 120), url: new URL(`/common/modules/iCalendar/iCalendar.aspx?catID=${catId}&feed=calendar`, pageUrl).toString() });
  }
  return [...out.values()];
}

/** LibCal's subscribe link ("ical_subscribe.php?src=p&cid=N") on a LibCal calendar page. */
export function libcalIcsUrl(html: string, pageUrl: string): string | null {
  const m = /href\s*=\s*["']([^"']*ical_subscribe\.php\?[^"']*cid=\d+[^"']*)["']/i.exec(html);
  return m ? resolve(m[1].replace(/&amp;/g, "&"), pageUrl) : null;
}

/** Calendars that are never event sources: meetings, agendas, boards, and closures (source rules). */
export const NOT_EVENTS_CALENDAR = /\b(meetings?|agendas?|council|commissions?|committees?|boards?|hearings?|closings?|closures?|adult (sports|softball|leagues?)|bids?|elections?)\b/i;

const pad = (n: number) => String(n).padStart(2, "0");
/** "20261021T100000" → "2026-10-21 10:00"; dates alone stay dates. */
export function icsWhen(value: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(value);
  if (!m) return value;
  return m[4] ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : `${m[1]}-${m[2]}-${m[3]}`;
}

/** Up to 5 sample events from an iCal feed, upcoming first; facts only. */
export function icsSamples(text: string, today: Date): { samples: DiscoverySample[]; count: number } {
  const cal = parseIcs(text, { maxEvents: 5000 });
  const ymd = `${today.getUTCFullYear()}${pad(today.getUTCMonth() + 1)}${pad(today.getUTCDate())}`;
  const dated = cal.events.filter((e) => e.summary && e.dtstart);
  const upcoming = dated.filter((e) => e.dtstart!.value.slice(0, 8) >= ymd).sort((a, b) => a.dtstart!.value.localeCompare(b.dtstart!.value));
  const repeating = dated.filter((e) => e.rrule && e.dtstart!.value.slice(0, 8) < ymd);
  const picked = [...upcoming, ...repeating].slice(0, 5);
  return {
    count: cal.events.length,
    samples: picked.map((e) => ({ title: e.summary!.slice(0, 200), startAt: `${icsWhen(e.dtstart!.value)}${e.rrule && e.dtstart!.value.slice(0, 8) < ymd ? " (repeats)" : ""}`, location: e.location?.slice(0, 200) ?? null, url: e.url })),
  };
}

/** Schema.org Event objects in a page's JSON-LD: up to 5 samples, facts only. */
export function jsonLdEvents(html: string): { samples: DiscoverySample[]; count: number } {
  const found = jsonLdEventObjects(html).map((o) => {
    const loc = o.location as Record<string, unknown> | undefined;
    return { title: decodeEntities(String(o.name)).slice(0, 200), startAt: String(o.startDate).slice(0, 25), location: typeof loc?.name === "string" ? decodeEntities(loc.name).slice(0, 200) : null, url: typeof o.url === "string" ? o.url : null };
  });
  return { samples: found.slice(0, 5), count: found.length };
}

/** Item titles and dates from an RSS or Atom feed: up to 5 samples. */
export function feedSamples(xml: string): { samples: DiscoverySample[]; count: number } {
  const items = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const text = (block: string, tag: string) => {
    const v = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block)?.[1];
    return v ? v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim() : null;
  };
  return {
    count: items.length,
    samples: items.slice(0, 5).map((b) => ({ title: (text(b, "title") ?? "(untitled)").slice(0, 200), startAt: text(b, "pubDate") ?? text(b, "updated") ?? text(b, "published") ?? "", location: null, url: null })),
  };
}

const FLAGS: [RegExp, string][] = [
  [/\bautomated\b/i, "automated"],
  [/\bscrap(e|es|ed|ing|er|ers)\b/i, "scrape"],
  [/\bcrawl(s|ed|ing|er|ers)?\b/i, "crawl"],
  [/\b(robots?|spiders?|bots?)\b/i, "robot or bot"],
  [/\bdata mining\b/i, "data mining"],
  [/\bharvest(ing)?\b/i, "harvest"],
  [/\b(may not|shall not|must not|prohibited from)\b[^.]{0,80}\b(copy|reproduce|republish|redistribute)/i, "no copying"],
  [/\bcommercial (use|purpose)/i, "commercial use"],
];

/** Phrases on a terms page the owner should read before approving a feed. */
export function termsFlags(text: string): string[] {
  return FLAGS.filter(([re]) => re.test(text)).map(([, label]) => label);
}

const FILTER_PHRASES = ["City Council", "Planning Commission", "Commission", "Committee", "Board Meeting", "Meeting", "Closed", "Closure", "Adult League", "Adult Softball"];

/** Title phrases worth suggesting as filter rules, from sample titles. */
export function suggestFilters(titles: readonly string[]): string[] {
  const matches = (p: string) => titles.filter((t) => new RegExp(`\\b${p}\\b`, "i").test(t));
  // Fewest phrases that cover every matching title: the broadest first ("Meeting" covers "City Council Meeting").
  const ranked = FILTER_PHRASES.map((p) => ({ p, hit: matches(p) })).filter((x) => x.hit.length).sort((a, b) => b.hit.length - a.hit.length);
  const covered = new Set<string>();
  const out: string[] = [];
  for (const { p, hit } of ranked) {
    if (hit.every((t) => covered.has(t))) continue;
    hit.forEach((t) => covered.add(t));
    out.push(p);
  }
  return out;
}
