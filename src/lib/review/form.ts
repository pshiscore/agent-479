import type { DailyHours, ProposedEvent } from "@/lib/db/schema";
import { chicagoParts, chicagoToUtc, parseDate } from "@/lib/time";

/**
 * The "Add event" and "Edit and approve" forms, as plain field values. Dates
 * and times are entered in Chicago time (AGENTS.md rule 5) and stored in UTC.
 * No start time means an all-day event; an all-day event's end is the end of
 * its last day.
 *
 * Per-day hours, when the page states them: one line per day
 * ("2026-10-15 08:00-17:00"), or "Same hours every day", which uses the start
 * and end times for every day from the start date to the end date.
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

const pad = (hm: string) => (hm.length === 4 ? `0${hm}` : hm);

/** "2026-10-15 08:00-17:00" per line (an en dash or "to" works too). */
export function parseDailyHours(text: string): DailyHours[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s*(?:-|–|to)\s*(\d{1,2}:\d{2})$/.exec(line);
      if (!m) throw new FormError(`daily hours: "${line}" should look like 2026-10-15 08:00-17:00`);
      return { day: m[1], opens: pad(m[2]), closes: pad(m[3]) };
    });
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

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
  let dailyHours = parseDailyHours(one(v, "dailyHours"));
  if (checked(v, "sameHours")) {
    if (allDay || !endTime || !endDate) throw new FormError("same hours every day needs a start time, an end date, and an end time");
    dailyHours = eachDay(startDate, endDate).map((day) => ({ day, opens: startTime, closes: endTime }));
  }
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
    dailyHours,
    parentEventId: one(v, "parentEventId") || null,
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
    dailyHours: (f.dailyHours ?? []).map((h) => `${h.day} ${h.opens ?? ""}-${h.closes ?? ""}`).join("\n"),
    parentEventId: f.parentEventId ?? "",
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
