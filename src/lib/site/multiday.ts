import { ONGOING_MIN_DAYS } from "@/config/front-page";
import { chicagoDate, chicagoToUtc, formatDate, parseDate } from "@/lib/time";
import type { EventItem } from "./queries";

/**
 * Multi-day events in lists (festivals step 2a; docs/product/festivals.md).
 * - An event is listed when it runs at any point in the view, not only when
 *   it starts there (listEvents matches by overlap).
 * - It's shown once: on its first day inside the view, with "Day 2 of 4"
 *   when the view starts mid-run, and that day's hours when they're stated.
 * - Runs of ONGOING_MIN_DAYS or more go to an "Ongoing" strip instead of the
 *   timeline, so a six-week light display doesn't take a slot every weekend.
 */

const DAY = 86_400_000;
export const chicagoDay = (d: Date) => formatDate(chicagoDate(d));
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T12:00:00Z`) / DAY);

export interface Placement {
  day: string; // the Chicago day it's listed under
  dayNumber: number; // 1-based, within the run
  dayCount: number;
  hours: { opensAt: Date | null; closesAt: Date | null } | null;
}

export type Placed = EventItem & { placement?: Placement };

/**
 * Chicago calendar days the event spans, when it's really a multi-day event:
 * all day, at least 24 hours, or with stated hours on more than one day. A
 * concert from 8 pm to 1 am is one day.
 */
export function spanDays(e: Pick<EventItem, "startAt" | "endAt" | "allDay" | "days">): number {
  if (!e.endAt) return 1;
  const days = dayNumber(chicagoDay(e.endAt)) - dayNumber(chicagoDay(e.startAt)) + 1;
  if (days <= 1) return 1;
  const multi = e.allDay || e.endAt.getTime() - e.startAt.getTime() >= DAY || e.days.length > 1;
  return multi ? days : 1;
}

/** Whether an event (overlap-matched) runs at any point in [from, to). */
export const overlaps = (e: Pick<EventItem, "startAt" | "endAt">, from: Date, to: Date) => e.startAt < to && (e.endAt ?? e.startAt) >= from;

/** Places each event once in a view starting at `from`; long runs go to `ongoing`. */
export function placeInView<T extends EventItem>(items: T[], from: Date): { timeline: (T & { placement?: Placement })[]; ongoing: T[] } {
  const viewDay = chicagoDay(from);
  const timeline: (T & { placement?: Placement })[] = [];
  const ongoing: T[] = [];
  for (const e of items) {
    const count = spanDays(e);
    if (count >= ONGOING_MIN_DAYS) {
      ongoing.push(e);
      continue;
    }
    if (count === 1) {
      timeline.push(e);
      continue;
    }
    const startDay = chicagoDay(e.startAt);
    const day = startDay >= viewDay ? startDay : viewDay;
    const n = dayNumber(day) - dayNumber(startDay) + 1;
    const h = e.days.find((d) => d.day === day);
    timeline.push({ ...e, placement: { day, dayNumber: n, dayCount: count, hours: h ? { opensAt: h.opensAt, closesAt: h.closesAt } : null } });
  }
  // Within a day: by the time it's listed at (that day's opening, else its start), so a continuing festival sorts sensibly.
  const at = (e: T & { placement?: Placement }) =>
    e.placement && e.placement.dayNumber > 1 ? (e.placement.hours?.opensAt ?? chicagoToUtc(parseDate(e.placement.day))).getTime() : e.startAt.getTime();
  timeline.sort((a, b) => at(a) - at(b) || a.title.localeCompare(b.title));
  ongoing.sort((a, b) => (a.endAt ?? a.startAt).getTime() - (b.endAt ?? b.startAt).getTime());
  return { timeline, ongoing };
}
