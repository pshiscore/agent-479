import type { DbExecutor } from "@/lib/db/client";
import { type DISCOVERY_KINDS, type DiscoverySample, type ROBOTS_RESULTS, sources } from "@/lib/db/schema";
import { FetchBlockedError, FetchNotPermittedError } from "@/lib/http/fetch";
import { eventsLink, pageText } from "@/lib/organizers/check";
import { FetchFailedError, type PoliteClient, type PoliteResponse } from "@/lib/sources/http";
import { civicPlusFeeds, decodeEntities, feedSamples, icsSamples, jsonLdEvents, libcalIcsUrl, NOT_EVENTS_CALENDAR, pageSignals, suggestFilters, termsFlags } from "./detect";

/**
 * Feed discovery for one organizer (docs/product/organizers.md, step 6). Reads
 * only robots-allowed pages through PoliteClient (robots.txt on every request,
 * per-host pauses, blocks stop): the home page, its events page, its terms
 * page, a CivicPlus feed list or LibCal page when there is one, and each
 * candidate feed once for samples. A block stops the organizer. Nothing is
 * stored except addresses, robots results, terms flags, and sample facts.
 */

export interface Find {
  url: string;
  label: string;
  kind: (typeof DISCOVERY_KINDS)[number];
  platform: string | null;
  robotsResult: (typeof ROBOTS_RESULTS)[number];
  robotsCheckedAt: Date;
  termsUrl: string | null;
  termsFlags: string[];
  sampleEvents: DiscoverySample[];
  suggestedFilters: string[];
  notes: string | null;
  // Identity for "already a source" checks (a CivicPlus calendar is host#catN).
  key: string;
}

export interface DiscoveryResult {
  finds: Find[];
  skipped: { label: string; url: string; reason: string }[];
  // Public Google Calendar ids seen on the pages: not fetched; the owner decides (the Google rule).
  googleCalendars: string[];
  blocked: string | null;
  errors: string[];
  // Stopped for time before reading every candidate: nothing is marked gone, and the organizer stays due.
  incomplete: boolean;
}

const MAX_FINDS = 10;

export const feedKey = (url: string, platform: string | null) => {
  const u = new URL(url);
  const cat = u.searchParams.get("catID");
  return platform === "civicplus" && cat ? `${u.hostname.replace(/^www\./, "")}#cat${cat}` : `${u.hostname.replace(/^www\./, "")}${u.pathname}${u.search}`;
};

/** Feeds our sources already read, as feedKey values. */
export async function knownFeedKeys(db: DbExecutor): Promise<Set<string>> {
  const rows = await db.select({ baseUrl: sources.baseUrl, config: sources.config }).from(sources);
  const keys = new Set<string>();
  for (const s of rows) {
    const c = s.config as { feedUrl?: string; icsPath?: string; catIds?: number[] };
    if (c.feedUrl) keys.add(feedKey(c.feedUrl, null));
    if (c.icsPath && c.catIds) for (const id of c.catIds) keys.add(feedKey(new URL(`${c.icsPath}?catID=${id}`, s.baseUrl).toString(), "civicplus"));
  }
  return keys;
}

const stopping = (err: unknown) => err instanceof FetchBlockedError || err instanceof FetchNotPermittedError;

export async function discoverOrganizer(
  http: PoliteClient,
  org: { name: string; website: string; eventsHint?: string | null },
  known: ReadonlySet<string>,
  today = new Date(),
  deadline?: { readonly passed: boolean },
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { finds: [], skipped: [], googleCalendars: [], blocked: null, errors: [], incomplete: false };
  const get = async (url: string, what: string): Promise<PoliteResponse | null> => {
    try {
      return await http.get(url, "text/html,application/xhtml+xml,text/calendar,application/rss+xml,*/*;q=0.5");
    } catch (err) {
      if (stopping(err)) throw err;
      result.errors.push(`${what}: ${err instanceof FetchFailedError ? err.reason : (err as Error).message}`.slice(0, 200));
      return null;
    }
  };

  try {
    const home = await get(org.website, "home page");
    if (!home) return result;
    const origin = new URL(home.url).origin;
    const signals = [pageSignals(home.text, home.url)];
    const eventsUrl = org.eventsHint ?? eventsLink(home.text, home.url);
    const events = eventsUrl && eventsUrl !== home.url ? await get(eventsUrl, "events page") : null;
    if (events) signals.push(pageSignals(events.text, events.url));

    // Terms: the link from the home page, read once for flagged phrases.
    const termsUrl = signals[0].termsLink;
    let flags: string[] = [];
    if (termsUrl) {
      const terms = await get(termsUrl, "terms page");
      if (terms) flags = termsFlags(pageText(terms.text));
    }

    const candidates: Omit<Find, "robotsResult" | "robotsCheckedAt" | "termsUrl" | "termsFlags" | "sampleEvents" | "suggestedFilters" | "key">[] = [];
    const add = (c: (typeof candidates)[number]) => {
      if (!candidates.some((x) => x.url === c.url)) candidates.push({ ...c, label: decodeEntities(c.label).replace(/\s+/g, " ").trim().slice(0, 160) });
    };

    if (signals.some((s) => s.civicplus)) {
      const listUrl = new URL("/iCalendar.aspx", origin).toString();
      const list = await get(listUrl, "CivicPlus feed list");
      for (const f of list ? civicPlusFeeds(list.text, list.url) : []) {
        if (NOT_EVENTS_CALENDAR.test(f.name)) result.skipped.push({ label: f.name, url: f.url, reason: "meeting, board, or closure calendar (never a source)" });
        else add({ url: f.url, label: f.name, kind: "ics", platform: "civicplus", notes: `Listed on ${listUrl}.` });
      }
    }
    for (const s of signals) {
      for (const a of s.alternates) {
        if (/calendar/i.test(a.type)) add({ url: a.href, label: a.title || "iCal feed", kind: "ics", platform: s.eventsCalendarPlugin ? "the_events_calendar" : null, notes: "Linked from the page head." });
        else if (/event|calendar/i.test(`${a.title} ${a.href}`)) add({ url: a.href, label: a.title || "Events feed", kind: "rss", platform: null, notes: "Linked from the page head." });
      }
      for (const href of s.icsLinks) add({ url: href, label: "iCal link", kind: "ics", platform: s.eventsCalendarPlugin ? "the_events_calendar" : null, notes: "Linked on the page." });
      result.googleCalendars.push(...s.googleCalendarIds.filter((id) => !result.googleCalendars.includes(id)));
    }
    if (signals.some((s) => s.eventsCalendarPlugin) && !candidates.some((c) => c.kind === "ics")) {
      add({ url: new URL("/events/?ical=1", origin).toString(), label: "Events calendar (iCal export)", kind: "ics", platform: "the_events_calendar", notes: "The Events Calendar plugin's standard export address." });
    }
    if (signals.some((s) => s.squarespace) && events) {
      const u = new URL(events.url);
      u.search = "format=ical";
      add({ url: u.toString(), label: "Squarespace events (iCal)", kind: "ics", platform: "squarespace", notes: "Squarespace's standard iCal address for an events page." });
    }
    const libcal = signals.flatMap((s) => s.libcalLinks)[0];
    if (libcal) {
      const page = await get(libcal, "LibCal page");
      const ics = page ? libcalIcsUrl(page.text, page.url) : null;
      if (ics) add({ url: ics, label: "LibCal calendar (iCal)", kind: "ics", platform: "libcal", notes: `Subscribe link on ${libcal}.` });
      else result.skipped.push({ label: "LibCal calendar", url: libcal, reason: "no subscribe link found on the page" });
    }
    const page = events ?? home;
    const ld = jsonLdEvents(page.text);
    if (ld.count > 0) add({ url: page.url, label: "Event data on the events page", kind: "page_data", platform: null, notes: `${ld.count} schema.org events on the page.` });
    if (signals.some((s) => s.revize) && candidates.length === 0) result.skipped.push({ label: "Revize calendar", url: page.url, reason: "no feed found on a Revize site" });

    // An organizer whose events we already read through a source gets only new CivicPlus calendars:
    // its other feeds and page data carry the same events.
    const hasSource = candidates.some((c) => known.has(feedKey(c.url, c.platform)));
    const usable: { find: Find; count: number }[] = [];
    for (const c of candidates) {
      const key = feedKey(c.url, c.platform);
      const skip = (reason: string) => result.skipped.push({ label: c.label, url: c.url, reason });
      if (known.has(key)) {
        skip("already a source");
        continue;
      }
      if (hasSource && c.platform !== "civicplus") {
        skip("same events as an existing source");
        continue;
      }
      if (deadline?.passed) {
        result.incomplete = true;
        skip("out of time; next run");
        continue;
      }
      if (usable.length >= MAX_FINDS) {
        skip(`over ${MAX_FINDS} feeds for one organizer; next run`);
        continue;
      }
      if (!(await http.allows(c.url))) {
        skip("robots.txt disallows this address (not read; ask the organizer)");
        continue;
      }
      let samples: { samples: DiscoverySample[]; count: number } | null = null;
      if (c.kind === "page_data") samples = ld;
      else {
        const before = result.errors.length;
        const feed = await get(c.url, c.label);
        if (!feed) {
          skip(`didn't answer as a feed (${result.errors.splice(before).join("; ").replace(`${c.label}: `, "")})`);
          continue;
        }
        try {
          samples = c.kind === "ics" ? icsSamples(feed.text, today) : feedSamples(feed.text);
        } catch {
          skip("not a readable feed (a web page, not a calendar)");
          continue;
        }
      }
      if (samples.count === 0 || samples.samples.length === 0) {
        skip("no events in the feed when read");
        continue;
      }
      usable.push({
        count: samples.count,
        find: {
          ...c,
          key,
          robotsResult: "allowed",
          robotsCheckedAt: new Date(),
          termsUrl,
          termsFlags: flags,
          sampleEvents: samples.samples,
          suggestedFilters: suggestFilters(samples.samples.map((s) => s.title)),
          notes: [c.notes, `${samples.count} events when read.`].filter(Boolean).join(" "),
        },
      });
    }
    // One proposal per set of events: every CivicPlus calendar, plus the best other way in
    // (iCal over event data on a page over RSS; then the feed with more events).
    const rank = { ics: 0, events_api: 1, page_data: 2, rss: 3, html: 4 } as const;
    const others = usable.filter((u) => u.find.platform !== "civicplus").sort((a, b) => rank[a.find.kind] - rank[b.find.kind] || b.count - a.count || a.find.url.length - b.find.url.length);
    for (const [i, u] of others.entries()) if (i > 0) result.skipped.push({ label: u.find.label, url: u.find.url, reason: `same events as ${others[0].find.url}` });
    result.finds = [...usable.filter((u) => u.find.platform === "civicplus").map((u) => u.find), ...others.slice(0, 1).map((u) => u.find)];
  } catch (err) {
    if (!stopping(err)) throw err;
    result.blocked = (err as Error).message.slice(0, 300);
  }
  return result;
}
