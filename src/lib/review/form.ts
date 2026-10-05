import type { ProposedEvent } from "@/lib/db/schema";
import { chicagoParts, chicagoToUtc, parseDate } from "@/lib/time";

/**
 * The "Add event" and "Edit and approve" forms, as plain field values. Dates
 * and times are entered in Chicago time (AGENTS.md rule 5) and stored in UTC.
 * No start time means an all-day event; an all-day event's end is the end of
 * its last day.
 */

export type EventFormValues = Record<string, string | string[] | undefined>;

const one = (v: EventFormValues, k: string) => {
  const x = v[k];
  return (Array.isArray(x) ? x[0] : x)?.trim() ?? "";
};
const many = (v: EventFormValues, k: string) => {
  const x = v[k];
  return (Array.isArray(x) ? x : x ? [x] : []).map((s) => s.trim()).filter(Boolean);
};
const num = (s: string) => (s === "" ? null : Number(s));
const checked = (v: EventFormValues, k: string) => one(v, k) === "1";

function at(date: string, time: string): Date {
  const [hour, minute] = time ? time.split(":").map(Number) : [0, 0];
  return chicagoToUtc(parseDate(date), { hour, minute });
}

export class FormError extends Error {}

export function parseEventForm(v: EventFormValues): ProposedEvent {
  const startDate = one(v, "startDate");
  const startTime = one(v, "startTime");
  const endDate = one(v, "endDate");
  const endTime = one(v, "endTime");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new FormError("a start date is required");
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new FormError("the end date isn't a date");
  const allDay = startTime === "";
  let endAt: Date | null = null;
  if (allDay) {
    if (endDate && endDate !== startDate) endAt = at(endDate, "23:59");
  } else if (endDate || endTime) {
    endAt = at(endDate || startDate, endTime || "23:59");
  }
  const free = checked(v, "free");
  return {
    title: one(v, "title"),
    startAt: at(startDate, startTime).toISOString(),
    endAt: endAt ? endAt.toISOString() : null,
    allDay,
    venueId: one(v, "venueId") || null,
    subSpace: one(v, "subSpace") || null,
    categoryId: one(v, "categoryId") || null,
    isFree: free ? true : null,
    priceMin: num(one(v, "priceMin")),
    priceMax: num(one(v, "priceMax")),
    ageMin: num(one(v, "ageMin")),
    ageMax: num(one(v, "ageMax")),
    registrationRequired: checked(v, "registration") ? true : null,
    inSpanish: checked(v, "spanish"),
    tagSlugs: many(v, "tags"),
    ticketUrl: one(v, "ticketUrl") || null,
    moreInfoUrl: one(v, "moreInfoUrl"),
  };
}

const ymd = (d: Date) => {
  const p = chicagoParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};
const hm = (d: Date) => {
  const p = chicagoParts(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

/** Form values for an existing proposal (Edit and approve). */
export function formValues(f: ProposedEvent): Record<string, string | string[]> {
  const start = new Date(f.startAt);
  const end = f.endAt ? new Date(f.endAt) : null;
  return {
    title: f.title,
    startDate: ymd(start),
    startTime: f.allDay ? "" : hm(start),
    endDate: end ? ymd(end) : "",
    endTime: end && !f.allDay ? hm(end) : "",
    venueId: f.venueId ?? "",
    subSpace: f.subSpace ?? "",
    categoryId: f.categoryId ?? "",
    free: f.isFree ? "1" : "",
    priceMin: f.priceMin?.toString() ?? "",
    priceMax: f.priceMax?.toString() ?? "",
    ageMin: f.ageMin?.toString() ?? "",
    ageMax: f.ageMax?.toString() ?? "",
    registration: f.registrationRequired ? "1" : "",
    spanish: f.inSpanish ? "1" : "",
    tags: f.tagSlugs,
    ticketUrl: f.ticketUrl ?? "",
    moreInfoUrl: f.moreInfoUrl,
  };
}

/** The fields that differ between two versions of the facts, for "Edit and approve". */
export function changedFields(before: ProposedEvent, after: ProposedEvent): Partial<ProposedEvent> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(after) as (keyof ProposedEvent)[]) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = after[k];
  }
  return out as Partial<ProposedEvent>;
}
