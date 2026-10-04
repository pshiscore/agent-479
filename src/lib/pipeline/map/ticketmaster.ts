import type { ticketmasterFacts } from "@/lib/sources/fetchers/ticketmaster";
import { type Facts, MapError, SkipRecord } from "./facts";
import { chicagoLocal, isChicagoZone } from "./time";

type TmEvent = ReturnType<typeof ticketmasterFacts>;

const STATUS: Record<string, Facts["status"]> = {
  onsale: "scheduled",
  offsale: "scheduled",
  rescheduled: "scheduled",
  cancelled: "cancelled",
  canceled: "cancelled",
  postponed: "postponed",
};

/**
 * Ticketmaster facts (already whitelisted at fetch time) to our facts. Links
 * point to Ticketmaster for purchase. Ticketmaster's venue coordinates are not
 * carried over: the venue comes from our own record (AGENTS.md).
 */
export function mapTicketmaster(payload: { format: "ticketmaster"; event: TmEvent }): Facts {
  const e = payload.event;
  if (!e.name) throw new MapError("event has no name");
  const s = e.start;
  if (!s?.localDate || s.dateTBD || s.dateTBA) throw new SkipRecord("date_tba", "Ticketmaster has no date yet");
  if (e.timezone && !isChicagoZone(e.timezone)) throw new MapError(`unsupported time zone "${e.timezone}"`);

  const timeTba = s.timeTBA || s.noSpecificTime || !s.localTime;
  // Prefer the UTC instant; fall back to the local date and time in Chicago.
  const startAt = timeTba ? chicagoLocal(s.localDate, null) : s.dateTime ? new Date(s.dateTime) : chicagoLocal(s.localDate, s.localTime);
  let endAt: Date | null = null;
  if (e.end?.dateTime && !e.end.timeTBA) endAt = new Date(e.end.dateTime);
  else if (e.end?.localDate && e.end.localTime) endAt = chicagoLocal(e.end.localDate, e.end.localTime);
  if (endAt && endAt.getTime() < startAt.getTime()) endAt = null;

  const prices = e.priceRanges.filter((p) => p.min !== null || p.max !== null);
  const mins = prices.map((p) => p.min).filter((n): n is number => n !== null);
  const maxes = prices.map((p) => p.max).filter((n): n is number => n !== null);
  const venue = e.venues[0];
  return {
    title: e.name,
    startAt: startAt.toISOString(),
    endAt: endAt?.toISOString() ?? null,
    allDay: false,
    timeTba,
    status: STATUS[(e.status ?? "").toLowerCase()] ?? "scheduled",
    sourceUrl: e.url,
    ticketUrl: e.url,
    location: {
      text: venue ? [venue.name, venue.address, venue.city].filter(Boolean).join(", ") : null,
      name: venue?.name ?? null,
      room: null,
      street: venue?.address ?? null,
      city: venue?.city ?? null,
      externalVenueId: venue?.id ?? null,
    },
    price: {
      min: mins.length ? Math.min(...mins) : null,
      max: maxes.length ? Math.max(...maxes) : null,
      currency: prices[0]?.currency ?? null,
    },
    performers: e.attractions.map((a) => a.name).filter((n): n is string => !!n),
    sourceCategories: [e.classification?.segment, e.classification?.genre, e.classification?.subGenre].filter(
      (c): c is string => !!c && c !== "Undefined",
    ),
    legalAgeEnforced: e.legalAgeEnforced,
    recurrence: null,
    timezoneAssumed: false,
  };
}
