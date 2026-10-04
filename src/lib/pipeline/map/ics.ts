import type { IcsEvent } from "@/lib/sources/ics";
import type { SourceRow } from "@/lib/sources/types";
import { type Facts, MapError } from "./facts";
import { parseLocation } from "./location";
import { durationMs, icsInstant } from "./time";

interface IcsPayload {
  format: "ics";
  feed: { url: string; defaultTimezone: string | null; timezones: string[] };
  event: Omit<IcsEvent, "description">;
}

/**
 * The event page link for sources whose feed has no URL. config.eventUrl is a
 * template with {uid}, relative to base_url or absolute; it's only used for
 * numeric UIDs, and each template was checked against a real event page.
 */
export function eventUrlFromTemplate(source: Pick<SourceRow, "baseUrl" | "config">, uid: string | null): string | null {
  const template = (source.config as { eventUrl?: unknown }).eventUrl;
  if (typeof template !== "string" || !uid || !/^\d+$/.test(uid)) return null;
  const url = new URL(template.replace("{uid}", uid), source.baseUrl);
  return url.protocol === "https:" ? url.toString() : null;
}

export function mapIcs(payload: IcsPayload, source: Pick<SourceRow, "baseUrl" | "config">): Facts {
  const e = payload.event;
  const tz = payload.feed.defaultTimezone ?? (payload.feed.timezones.length === 1 ? payload.feed.timezones[0] : null);
  if (!e.summary) throw new MapError("event has no title");
  if (!e.dtstart) throw new MapError("event has no start");

  const start = icsInstant(e.dtstart, tz);
  let endAt: Date | null = null;
  if (e.dtend) endAt = icsInstant(e.dtend, tz).at;
  else if (e.duration) endAt = new Date(start.at.getTime() + durationMs(e.duration));
  // A zero-length or inverted range is a source error: drop the end, keep the start.
  if (endAt && endAt.getTime() < start.at.getTime()) endAt = null;

  const loc = parseLocation(e.location);
  const url = e.url ?? eventUrlFromTemplate(source, e.uid);
  return {
    title: e.summary,
    startAt: start.at.toISOString(),
    endAt: endAt?.toISOString() ?? null,
    allDay: start.allDay,
    timeTba: false,
    status: e.status === "CANCELLED" ? "cancelled" : "scheduled",
    sourceUrl: url,
    ticketUrl: null,
    location: { ...loc, externalVenueId: null },
    price: { min: null, max: null, currency: null },
    performers: [],
    sourceCategories: e.categories,
    legalAgeEnforced: null,
    recurrence: e.rrule ? { rrule: e.rrule, exdates: e.exdate.map((x) => x.value) } : null,
    timezoneAssumed: start.assumed,
  };
}
