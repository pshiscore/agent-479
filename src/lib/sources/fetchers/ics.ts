import { z } from "zod";
import { FetchFailedError } from "../http";
import { icsDescriptionPurgeAfter, icsExternalId, IcsParseError, parseIcs } from "../ics";
import { type Fetcher, type FetchedItem, SourceConfigError, type SourceRow } from "../types";

/**
 * ICS feeds. A source's config gives either one `feedUrl`, or a CivicPlus
 * `icsPath` plus `catIds` (one feed per category). Items are keyed by UID (plus
 * RECURRENCE-ID), so an event listed in two categories is stored once.
 */

const configSchema = z.union([
  z.object({ feedUrl: z.url({ protocol: /^https$/ }) }),
  z.object({
    icsPath: z.string().startsWith("/"),
    catIds: z.array(z.number().int().positive()).min(1),
  }),
]);

export function icsFeedUrls(source: Pick<SourceRow, "slug" | "baseUrl" | "config">): string[] {
  const parsed = configSchema.safeParse(source.config);
  if (!parsed.success) {
    throw new SourceConfigError(
      `${source.slug}: config needs feedUrl, or icsPath and catIds (${z.prettifyError(parsed.error)})`,
    );
  }
  const c = parsed.data;
  if ("feedUrl" in c) return [c.feedUrl];
  return c.catIds.map((id) => {
    const u = new URL(c.icsPath, source.baseUrl);
    u.searchParams.set("catID", String(id));
    u.searchParams.set("feed", "calendar");
    return String(u);
  });
}

export const icsFetcher: Fetcher = {
  name: "ics",
  async fetch(source, http) {
    const byId = new Map<string, FetchedItem>();
    const feedUrls: string[] = [];
    let events = 0;
    let duplicates = 0;

    for (const url of icsFeedUrls(source)) {
      const res = await http.get(url, "text/calendar, */*;q=0.5");
      feedUrls.push(res.url);
      let cal;
      try {
        cal = parseIcs(res.text);
      } catch (err) {
        // A challenge or error page served with a 200 lands here.
        if (err instanceof IcsParseError) throw new FetchFailedError(res.url, `not a valid calendar: ${err.message}`);
        throw err;
      }
      for (const event of cal.events) {
        events++;
        const externalId = icsExternalId(event);
        if (byId.has(externalId)) {
          duplicates++;
          continue;
        }
        // The description goes to its own internal column, never into the payload.
        const { description, ...facts } = event;
        byId.set(externalId, {
          externalId,
          sourceUrl: event.url,
          payload: {
            format: "ics",
            feed: { url: res.url, defaultTimezone: cal.defaultTimezone, timezones: cal.timezones },
            event: facts,
          },
          descriptionText: description,
          descriptionPurgeAfter: icsDescriptionPurgeAfter(event),
        });
      }
    }
    return { items: [...byId.values()], feedUrls, stats: { events, duplicates } };
  },
};
