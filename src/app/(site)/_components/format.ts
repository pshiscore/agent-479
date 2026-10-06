import type { EventItem } from "@/lib/site/queries";

/** Display formats, always in Chicago time (AGENTS.md rule 5). */

const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", ...o }).format(d);

export const timeOf = (e: Pick<EventItem, "startAt" | "allDay" | "timeTba">) =>
  e.allDay ? "All day" : e.timeTba ? "Time TBA" : fmt(e.startAt, { hour: "numeric", minute: "2-digit" });

export const dayHeading = (d: Date) => fmt(d, { weekday: "long", month: "long", day: "numeric" });
export const shortDate = (d: Date) => fmt(d, { weekday: "short", month: "short", day: "numeric" });
export const longWhen = (e: Pick<EventItem, "startAt" | "allDay" | "timeTba">) =>
  e.allDay || e.timeTba ? `${dayHeading(e.startAt)}${e.timeTba ? ", time TBA" : ""}` : `${dayHeading(e.startAt)} at ${timeOf(e)}`;

/** "Ages 3 to 5", "Grades 7 and 8", "Ages 18 and up": as stated in the facts. */
export function agesLine(e: Pick<EventItem, "ageMin" | "ageMax" | "gradeMin" | "gradeMax">): string | null {
  const range = (label: string, min: number | null, max: number | null) => {
    if (min !== null && max !== null) return max - min === 1 ? `${label} ${min} and ${max}` : `${label} ${min} to ${max}`;
    if (min !== null) return `${label} ${min} and up`;
    if (max !== null) return `${label} up to ${max}`;
    return null;
  };
  return range("Ages", e.ageMin, e.ageMax) ?? range("Grades", e.gradeMin, e.gradeMax);
}

/** A Chicago calendar date ("2026-10-16") for URLs. */
export const isoDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const md = (d: Date) => fmt(d, { month: "short", day: "numeric" });
const yr = (d: Date) => fmt(d, { year: "numeric" });

/** "Oct 15–18", "Oct 30 – Nov 2", "Dec 30, 2026 – Jan 2, 2027" (festivals 2a). */
export function rangeLabel(start: Date, end: Date): string {
  if (yr(start) !== yr(end)) return `${md(start)}, ${yr(start)} – ${md(end)}, ${yr(end)}`;
  const [sm, sd] = md(start).split(" ");
  const [em, ed] = md(end).split(" ");
  return sm === em ? `${sm} ${sd}–${ed}` : `${md(start)} – ${md(end)}`;
}

/** "Through Jan 1" once it has started; the full range before that. */
export const ongoingLabel = (e: Pick<EventItem, "startAt" | "endAt">, now: Date) =>
  e.endAt ? (e.startAt <= now ? `Through ${md(e.endAt)}` : rangeLabel(e.startAt, e.endAt)) : shortDate(e.startAt);

/** "8:00 AM–5:00 PM", a day's stated hours. */
export const hoursLabel = (h: { opensAt: Date | null; closesAt: Date | null }) =>
  [h.opensAt, h.closesAt].map((d) => (d ? fmt(d, { hour: "numeric", minute: "2-digit" }) : null)).filter(Boolean).join("–");
