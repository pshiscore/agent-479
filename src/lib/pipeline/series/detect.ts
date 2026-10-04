import { chicagoDate, chicagoParts } from "@/lib/time";

/**
 * Series detection (plan section 5, rule 8), pure. Given the occurrences of
 * one group (same source, venue, and normalized title):
 *   - a run: two or more occurrences on consecutive days ("Oct 6–11"), such as
 *     a touring show's performances;
 *   - recurring: a weekday-and-time slot with 3 or more occurrences within 60
 *     days ("Tuesdays", "Tue & Thu", "Every other Tuesday"). Only the
 *     occurrences in qualifying slots join; one-offs at other times don't.
 * Labels are computed here, in code, never by a model. Times and weekdays are
 * Chicago's.
 */

export interface Occurrence {
  eventId: string;
  startAt: Date;
  allDay: boolean;
  timeTba: boolean;
}

export type SeriesKind = "recurring" | "run";

export interface SeriesPlan {
  kind: SeriesKind;
  label: string;
  members: string[];
}

export const RECURRING_MIN = 3;
export const RECURRING_WINDOW_DAYS = 60;
// A "run" longer than this is a long stretch of daily events, not a show's run.
export const RUN_MAX_DAYS = 21;

const DAY = 86_400_000;
const WEEKDAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const dayNumber = (d: Date) => {
  const c = chicagoDate(d);
  return Date.UTC(c.year, c.month - 1, c.day) / DAY;
};

export function runLabel(first: Date, last: Date): string {
  const a = chicagoDate(first);
  const b = chicagoDate(last);
  if (a.year === b.year && a.month === b.month) return `${MONTH[a.month]} ${a.day}–${b.day}`;
  return `${MONTH[a.month]} ${a.day}–${MONTH[b.month]} ${b.day}`;
}

/** "Tuesdays", "Tue & Thu", "Mon, Wed & Fri", "Weekdays", "Weekends", "Daily", "Every other Tuesday". */
export function weekdayLabel(weekdays: Iterable<number>, everyOther = false): string {
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  const key = days.join("");
  if (key === "1234567") return "Daily";
  if (key === "12345") return "Weekdays";
  if (key === "67") return everyOther ? "Every other weekend" : "Weekends";
  if (days.length === 1) return everyOther ? `Every other ${WEEKDAY[days[0]]}` : `${WEEKDAY[days[0]]}s`;
  const names = days.map((d) => SHORT[d]);
  const list = `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
  return everyOther ? `Every other ${list}` : list;
}

export function planSeries(occurrences: readonly Occurrence[]): SeriesPlan | null {
  const occ = [...occurrences].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  if (occ.length < 2) return null;

  // A run: every date follows the previous one by a day (several shows a day are fine).
  const dates = [...new Set(occ.map((o) => dayNumber(o.startAt)))].sort((a, b) => a - b);
  const consecutive = dates.length >= 2 && dates.every((d, i) => i === 0 || d - dates[i - 1] === 1);
  if (consecutive && dates.length <= RUN_MAX_DAYS) {
    return { kind: "run", label: runLabel(occ[0].startAt, occ.at(-1)!.startAt), members: occ.map((o) => o.eventId) };
  }

  // Recurring: slots of weekday plus start time (all-day and time-TBA share one slot per weekday).
  const slots = new Map<string, Occurrence[]>();
  for (const o of occ) {
    const p = chicagoParts(o.startAt);
    const time = o.allDay || o.timeTba ? "any" : `${p.hour}:${p.minute}`;
    const key = `${p.weekday}|${time}`;
    slots.set(key, [...(slots.get(key) ?? []), o]);
  }
  const qualifying = [...slots.entries()].filter(([, list]) =>
    list.some((o, i) => i + RECURRING_MIN - 1 < list.length && list[i + RECURRING_MIN - 1].startAt.getTime() - o.startAt.getTime() <= RECURRING_WINDOW_DAYS * DAY),
  );
  if (qualifying.length === 0) return null;

  // "Every other" only when every gap in every qualifying slot is exactly two weeks.
  const gaps = qualifying.flatMap(([, list]) => {
    const d = [...new Set(list.map((o) => dayNumber(o.startAt)))];
    return d.slice(1).map((x, i) => x - d[i]);
  });
  const everyOther = gaps.length > 0 && gaps.every((g) => g === 14);
  const weekdays = qualifying.map(([key]) => Number(key.split("|")[0]));
  const members = qualifying.flatMap(([, list]) => list.map((o) => o.eventId));
  return { kind: "recurring", label: weekdayLabel(weekdays, everyOther), members: occ.map((o) => o.eventId).filter((id) => members.includes(id)) };
}

const RRULE_DAYS: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
const ORDINAL: Record<string, string> = { "1": "First", "2": "Second", "3": "Third", "4": "Fourth", "-1": "Last" };

/**
 * A label from an ICS RRULE ("FREQ=WEEKLY;BYDAY=TU,TH" → "Tue & Thu"), or null
 * when the rule is one we don't describe; the series then gets "Recurring".
 */
export function rruleLabel(rrule: string): string | null {
  const parts = Object.fromEntries(
    rrule
      .replace(/^RRULE:/i, "")
      .split(";")
      .map((p) => p.split("=") as [string, string])
      .filter(([k, v]) => k && v)
      .map(([k, v]) => [k.toUpperCase(), v.toUpperCase()]),
  );
  const interval = Number(parts.INTERVAL ?? "1");
  const byday = (parts.BYDAY ?? "").split(",").filter(Boolean);
  switch (parts.FREQ) {
    case "DAILY":
      return interval === 1 ? "Daily" : null;
    case "WEEKLY": {
      const days = byday.map((d: string) => RRULE_DAYS[d]).filter(Boolean);
      if (days.length === 0 || days.length !== byday.length || interval > 2) return null;
      return weekdayLabel(days, interval === 2);
    }
    case "MONTHLY": {
      const m = /^(-?\d)(MO|TU|WE|TH|FR|SA|SU)$/.exec(byday[0] ?? "");
      if (byday.length !== 1 || !m || !ORDINAL[m[1]] || interval !== 1) return null;
      return `${ORDINAL[m[1]]} ${WEEKDAY[RRULE_DAYS[m[2]]]} of the month`;
    }
    default:
      return null;
  }
}
