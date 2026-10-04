import { z } from "zod";
import { geohash } from "../geohash";
import { FetchFailedError } from "../http";
import { type Fetcher, type FetchedItem, SourceConfigError, type SourceRow } from "../types";

/**
 * Ticketmaster Discovery API v2. Facts and links only (AGENTS.md rule 4, and
 * Ticketmaster's terms): the payload is built field by field from a
 * whitelist, so images, info, pleaseNote, promoter text, and descriptions
 * can't slip through. No description is stored for Ticketmaster at all.
 *
 * The API key travels in the query string; PoliteClient and the error classes
 * redact it from every URL they return or report.
 */

const configSchema = z.object({
  center: z.object({ lat: z.number(), lng: z.number() }),
  radiusMiles: z.number().int().positive().max(100),
  windowDays: z.number().int().positive().max(365),
  pageSize: z.number().int().positive().max(200),
});

// The Discovery API serves at most 1,000 results per query (page * size < 1000).
const DEEP_PAGING_LIMIT = 1_000;

const str = z.string().nullish();
const venueSchema = z.object({
  id: z.string(),
  name: str,
  address: z.object({ line1: str }).nullish(),
  city: z.object({ name: str }).nullish(),
  state: z.object({ stateCode: str }).nullish(),
  postalCode: str,
  location: z.object({ latitude: str, longitude: str }).nullish(),
});
const dateSchema = z
  .object({
    localDate: str,
    localTime: str,
    dateTime: str,
    dateTBD: z.boolean().nullish(),
    dateTBA: z.boolean().nullish(),
    timeTBA: z.boolean().nullish(),
    noSpecificTime: z.boolean().nullish(),
  })
  .nullish();
const eventSchema = z.object({
  id: z.string(),
  name: str,
  url: str,
  dates: z
    .object({
      start: dateSchema,
      end: dateSchema,
      timezone: str,
      status: z.object({ code: str }).nullish(),
    })
    .nullish(),
  priceRanges: z
    .array(z.object({ type: str, currency: str, min: z.number().nullish(), max: z.number().nullish() }))
    .nullish(),
  classifications: z
    .array(
      z.object({
        primary: z.boolean().nullish(),
        segment: z.object({ name: str }).nullish(),
        genre: z.object({ name: str }).nullish(),
        subGenre: z.object({ name: str }).nullish(),
      }),
    )
    .nullish(),
  ageRestrictions: z.object({ legalAgeEnforced: z.boolean().nullish() }).nullish(),
  _embedded: z
    .object({
      venues: z.array(venueSchema).nullish(),
      attractions: z.array(z.object({ id: z.string(), name: str })).nullish(),
    })
    .nullish(),
});
const pageSchema = z.object({
  _embedded: z.object({ events: z.array(z.unknown()) }).nullish(),
  page: z.object({ totalElements: z.number(), totalPages: z.number(), number: z.number() }),
});

type TmEvent = z.infer<typeof eventSchema>;
const orNull = <T>(v: T | null | undefined): T | null => v ?? null;
const num = (v: string | null | undefined) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
const https = (v: string | null | undefined) => (v && /^https:\/\//i.test(v) ? v : null);

function pickDate(d: z.infer<typeof dateSchema>) {
  if (!d) return null;
  return {
    localDate: orNull(d.localDate),
    localTime: orNull(d.localTime),
    dateTime: orNull(d.dateTime),
    dateTBD: d.dateTBD ?? false,
    dateTBA: d.dateTBA ?? false,
    timeTBA: d.timeTBA ?? false,
    noSpecificTime: d.noSpecificTime ?? false,
  };
}

/** The whitelist: every field we keep, and nothing else. */
export function ticketmasterFacts(e: TmEvent) {
  return {
    id: e.id,
    name: orNull(e.name),
    url: https(e.url),
    start: pickDate(e.dates?.start),
    end: pickDate(e.dates?.end),
    timezone: orNull(e.dates?.timezone),
    status: orNull(e.dates?.status?.code),
    priceRanges: (e.priceRanges ?? []).map((p) => ({
      type: orNull(p.type),
      currency: orNull(p.currency),
      min: orNull(p.min),
      max: orNull(p.max),
    })),
    // A hint for our classifier only, never shown as our category.
    classification: (() => {
      const c = e.classifications?.find((x) => x.primary) ?? e.classifications?.[0];
      return c
        ? { segment: orNull(c.segment?.name), genre: orNull(c.genre?.name), subGenre: orNull(c.subGenre?.name) }
        : null;
    })(),
    legalAgeEnforced: e.ageRestrictions?.legalAgeEnforced ?? null,
    venues: (e._embedded?.venues ?? []).map((v) => ({
      id: v.id,
      name: orNull(v.name),
      address: orNull(v.address?.line1),
      city: orNull(v.city?.name),
      state: orNull(v.state?.stateCode),
      postalCode: orNull(v.postalCode),
      lat: num(v.location?.latitude),
      lng: num(v.location?.longitude),
    })),
    attractions: (e._embedded?.attractions ?? []).map((a) => ({ id: a.id, name: orNull(a.name) })),
  };
}

/** Discovery API times: second precision, UTC, with a Z ("2026-10-03T15:00:00Z"). */
const tmTime = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

export function ticketmasterPageUrl(source: Pick<SourceRow, "slug" | "baseUrl" | "config">, apiKey: string, page: number, now: Date) {
  const parsed = configSchema.safeParse(source.config);
  if (!parsed.success) throw new SourceConfigError(`${source.slug}: ${z.prettifyError(parsed.error)}`);
  const c = parsed.data;
  const u = new URL("events.json", source.baseUrl);
  u.searchParams.set("apikey", apiKey);
  u.searchParams.set("geoPoint", geohash(c.center.lat, c.center.lng, 7));
  u.searchParams.set("radius", String(c.radiusMiles));
  u.searchParams.set("unit", "miles");
  u.searchParams.set("startDateTime", tmTime(now));
  u.searchParams.set("endDateTime", tmTime(new Date(now.getTime() + c.windowDays * 86_400_000)));
  u.searchParams.set("sort", "date,asc");
  u.searchParams.set("size", String(c.pageSize));
  u.searchParams.set("page", String(page));
  return { url: String(u), pageSize: c.pageSize };
}

export function makeTicketmasterFetcher(opts: { apiKey?: () => string | undefined; now?: () => Date } = {}): Fetcher {
  const apiKey = opts.apiKey ?? (() => process.env.TICKETMASTER_API_KEY);
  const now = opts.now ?? (() => new Date());
  return {
    name: "ticketmaster",
    async fetch(source, http) {
      const key = apiKey()?.trim();
      if (!key) throw new SourceConfigError("TICKETMASTER_API_KEY is not set");
      const at = now();
      const items: FetchedItem[] = [];
      const feedUrls: string[] = [];
      let skipped = 0;
      let total = 0;
      for (let page = 0; ; page++) {
        const { url, pageSize } = ticketmasterPageUrl(source, key, page, at);
        if ((page + 1) * pageSize > DEEP_PAGING_LIMIT) break;
        const res = await http.get(url, "application/json");
        feedUrls.push(res.url);
        let body;
        try {
          body = pageSchema.parse(JSON.parse(res.text));
        } catch (err) {
          throw new FetchFailedError(res.url, `unexpected response: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
        }
        total = body.page.totalElements;
        for (const raw of body._embedded?.events ?? []) {
          const parsed = eventSchema.safeParse(raw);
          if (!parsed.success) {
            skipped++;
            continue;
          }
          const facts = ticketmasterFacts(parsed.data);
          items.push({
            externalId: facts.id,
            sourceUrl: facts.url,
            payload: { format: "ticketmaster", event: facts },
            // Facts and links only: Ticketmaster text is never stored.
            descriptionText: null,
            descriptionPurgeAfter: null,
          });
        }
        if (page + 1 >= body.page.totalPages) break;
      }
      return {
        items,
        feedUrls,
        stats: { totalAvailable: total, events: items.length, skipped, truncated: total > items.length + skipped ? 1 : 0 },
      };
    },
  };
}

export const ticketmasterFetcher = makeTicketmasterFetcher();
