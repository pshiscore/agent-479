import { z } from "zod";
import { jsonLdEventObjects, jsonLdFacts } from "../jsonld";
import { type Fetcher, type FetchedItem, SourceConfigError, type SourceRow } from "../types";

/**
 * The structured-data fetcher (step 7; docs/product/organizers.md): reads
 * schema.org events from a page's JSON-LD, no AI. Still automated fetching:
 * every request goes through PoliteClient (robots.txt, pauses, a block stops),
 * the pipeline's enabled guard applies, and this fetcher itself refuses a
 * source awaiting permission or blocked, or a page on another site. Follows
 * the page's rel="next" link, same site only, up to `maxPages`.
 */

const configSchema = z.object({
  pageUrl: z.url({ protocol: /^https$/ }),
  maxPages: z.number().int().min(1).max(5).optional(),
});

const site = (u: string) => new URL(u).hostname.replace(/^www\./, "");
const DAY_MS = 86_400_000;

function nextLink(html: string, pageUrl: string): string | null {
  for (const m of html.matchAll(/<(?:link|a)\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']?next\b/i.test(m[0])) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    if (!href) continue;
    try {
      const u = new URL(href.replace(/&amp;/g, "&"), pageUrl);
      if (u.protocol === "https:" && site(u.toString()) === site(pageUrl)) return u.toString();
    } catch {
      // A bad href says nothing.
    }
  }
  return null;
}

/** 30 days after the event ends (plus a day of slack), like the iCal rule. */
function purgeAfter(start: string, end: string | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(end ?? start);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + 31 * DAY_MS) : null;
}

export function jsonLdConfig(source: Pick<SourceRow, "slug" | "baseUrl" | "config">) {
  const parsed = configSchema.safeParse(source.config);
  if (!parsed.success) throw new SourceConfigError(`${source.slug}: config needs pageUrl (${z.prettifyError(parsed.error)})`);
  if (site(parsed.data.pageUrl) !== site(source.baseUrl)) throw new SourceConfigError(`${source.slug}: pageUrl must be on the source's own site (${site(source.baseUrl)})`);
  return { pageUrl: parsed.data.pageUrl, maxPages: parsed.data.maxPages ?? 1 };
}

export const jsonLdFetcher: Fetcher = {
  name: "jsonld",
  async fetch(source, http) {
    if (source.disabledReason === "awaiting_permission" || source.disabledReason === "blocked") {
      throw new SourceConfigError(`${source.slug} is ${source.disabledReason}; structured data is still fetching, so it waits like any other`);
    }
    const { pageUrl, maxPages } = jsonLdConfig(source);
    const byId = new Map<string, FetchedItem>();
    const feedUrls: string[] = [];
    let events = 0;
    let duplicates = 0;
    let url: string | null = pageUrl;
    for (let page = 0; url && page < maxPages; page++) {
      const res = await http.get(url, "text/html,application/xhtml+xml");
      feedUrls.push(res.url);
      for (const o of jsonLdEventObjects(res.text)) {
        events++;
        const { facts, description } = jsonLdFacts(o, res.url);
        const externalId = `${facts.url ?? facts.name}#${facts.startDate}`.slice(0, 500);
        if (byId.has(externalId)) {
          duplicates++;
          continue;
        }
        byId.set(externalId, {
          externalId,
          sourceUrl: facts.url,
          payload: { format: "jsonld", page: { url: res.url }, event: facts },
          descriptionText: description,
          descriptionPurgeAfter: purgeAfter(facts.startDate, facts.endDate),
        });
      }
      url = nextLink(res.text, res.url);
      if (url && feedUrls.includes(url)) url = null;
    }
    return { items: [...byId.values()], feedUrls, stats: { pages: feedUrls.length, events, duplicates } };
  },
};
