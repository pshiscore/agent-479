import type { JsonLdFacts } from "@/lib/sources/jsonld";
import { chicagoParts, chicagoToUtc } from "@/lib/time";
import { type Facts, MapError, SkipRecord } from "./facts";

/**
 * JSON-LD event facts (the structured-data fetcher) to our facts. Times are
 * strict (AGENTS.md rule 5): a date alone is all day; a time without an offset
 * is Chicago time, marked assumed; a time with an offset must be Chicago's
 * actual offset at that moment, otherwise the record fails rather than guess
 * (a site set to UTC by mistake writes local times with +00:00).
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

export function jsonLdInstant(value: string): { at: Date; allDay: boolean; assumed: boolean } {
  const v = value.trim();
  const d = DATE.exec(v);
  if (d) return { at: chicagoToUtc({ year: Number(d[1]), month: Number(d[2]), day: Number(d[3]) }), allDay: true, assumed: false };
  const m = DATE_TIME.exec(v);
  if (!m) throw new MapError(`unreadable date "${value}"`);
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const time = { hour: Number(m[4]), minute: Number(m[5]), second: Number(m[6] ?? 0) };
  if (!m[7]) return { at: chicagoToUtc(date, time), allDay: false, assumed: true };
  const at = new Date(Date.parse(v.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2")));
  if (Number.isNaN(at.getTime())) throw new MapError(`unreadable date "${value}"`);
  const p = chicagoParts(at);
  const wallMatches = p.year === date.year && p.month === date.month && p.day === date.day && p.hour === time.hour && p.minute === time.minute;
  if (!wallMatches) throw new MapError(`time "${value}" isn't Chicago time (its offset doesn't match Chicago's on that date)`);
  return { at, allDay: false, assumed: false };
}

const STATUS: Record<string, Facts["status"]> = { EventCancelled: "cancelled", EventPostponed: "postponed" };

export function mapJsonLd(payload: { format: "jsonld"; page: { url: string }; event: JsonLdFacts }): Facts {
  const e = payload.event;
  if (!e.name) throw new MapError("event has no name");
  if (e.attendanceMode === "OnlineEventAttendanceMode" || e.location?.virtual) throw new SkipRecord("online_only", "online event");
  const start = jsonLdInstant(e.startDate);
  let endAt: Date | null = null;
  if (e.endDate) {
    const end = jsonLdInstant(e.endDate);
    // An all-day end is inclusive in JSON-LD; ours is the exclusive end (the next midnight).
    endAt = end.allDay ? new Date(chicagoToUtc({ ...dayAfter(e.endDate) }).getTime()) : end.at;
    if (endAt.getTime() <= start.at.getTime()) endAt = null;
  }
  const prices = e.offers.flatMap((o) => [o.price, o.lowPrice, o.highPrice]).filter((n): n is number => n !== null);
  return {
    title: e.name,
    startAt: start.at.toISOString(),
    endAt: endAt?.toISOString() ?? null,
    allDay: start.allDay,
    timeTba: false,
    status: STATUS[e.eventStatus ?? ""] ?? "scheduled",
    sourceUrl: e.url,
    ticketUrl: e.offers.find((o) => o.url && o.url !== e.url)?.url ?? null,
    location: {
      text: e.location?.text ?? null,
      name: e.location?.name ?? null,
      room: null,
      street: e.location?.street ?? null,
      city: e.location?.city ?? null,
      externalVenueId: null,
    },
    price: { min: prices.length ? Math.min(...prices) : null, max: prices.length ? Math.max(...prices) : null, currency: e.offers.find((o) => o.currency)?.currency ?? null },
    performers: e.performers,
    // The schema.org subtype ("MusicEvent" → "Music") is a hint for our classifier only.
    sourceCategories: e.type !== "Event" ? [e.type.replace(/Event$/, "")] : [],
    legalAgeEnforced: null,
    recurrence: null,
    timezoneAssumed: start.assumed,
  };
}

function dayAfter(dateish: string) {
  const m = DATE.exec(dateish.trim().slice(0, 10))!;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
