/**
 * Time rules: store instants as UTC (timestamptz); compute calendar days and
 * display in America/Chicago. Everything here is pure and uses Intl only.
 */

export const CHICAGO = "America/Chicago";

/** A calendar date with no time zone. month is 1-12. */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** Wall-clock time in Chicago. weekday is ISO: 1 = Monday ... 7 = Sunday. */
export interface ChicagoParts extends CalendarDate {
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CHICAGO,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  weekday: "short",
});

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function chicagoParts(instant: Date): ChicagoParts {
  const parts: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(instant)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday],
  };
}

/** Chicago's UTC offset at an instant, in minutes (e.g. -300 for CDT). */
function offsetMinutes(instant: Date): number {
  const p = chicagoParts(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/**
 * Converts a Chicago wall-clock time to a UTC instant.
 *
 * DST edge cases are resolved deterministically:
 * - Nonexistent time (spring-forward gap, e.g. 2:30am on Mar 8 2026) moves
 *   forward by the gap: 2:30am → 3:30am CDT.
 * - Ambiguous time (fall-back repeat, e.g. 1:30am on Nov 1 2026) resolves to
 *   the earlier instant (CDT).
 */
export function chicagoToUtc(
  date: CalendarDate,
  time: { hour?: number; minute?: number; second?: number } = {},
): Date {
  const { hour = 0, minute = 0, second = 0 } = time;
  const wallAsUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute, second);
  // Try both offsets that could apply near this wall time.
  const candidates = new Set<number>();
  for (const probe of [wallAsUtc - 12 * 3_600_000, wallAsUtc + 12 * 3_600_000]) {
    candidates.add(wallAsUtc - offsetMinutes(new Date(probe)) * 60_000);
  }
  const matches = [...candidates]
    .filter((t) => {
      const p = chicagoParts(new Date(t));
      return (
        p.year === date.year &&
        p.month === date.month &&
        p.day === date.day &&
        p.hour === hour &&
        p.minute === minute &&
        p.second === second
      );
    })
    .sort((a, b) => a - b);
  if (matches.length > 0) return new Date(matches[0]);
  // In the spring-forward gap: apply the pre-transition (standard) offset,
  // which lands the same distance past the gap.
  const before = offsetMinutes(new Date(wallAsUtc - 12 * 3_600_000));
  return new Date(wallAsUtc - before * 60_000);
}

/** The Chicago calendar date of an instant. */
export function chicagoDate(instant: Date): CalendarDate {
  const { year, month, day } = chicagoParts(instant);
  return { year, month, day };
}

/** "YYYY-MM-DD", the format of Postgres `date` columns. */
export function formatDate(date: CalendarDate): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

export function parseDate(value: string): CalendarDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new Error(`Invalid date string: ${value}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Calendar arithmetic, independent of time zones and DST. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** ISO weekday of a calendar date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: CalendarDate): number {
  const dow = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export interface WeekendWindow {
  /** Friday, as stored in digests.period_start. */
  periodStart: string;
  /** Sunday, as stored in digests.period_end. */
  periodEnd: string;
  /** Friday 00:00 Chicago, inclusive. */
  startUtc: Date;
  /** Monday 00:00 Chicago, exclusive. */
  endUtc: Date;
}

/**
 * The digest weekend for a given moment: the current weekend if it's Friday,
 * Saturday, or Sunday in Chicago, otherwise the coming one.
 */
export function weekendWindow(now: Date): WeekendWindow {
  const today = chicagoDate(now);
  // Mon-Thu step forward to Friday; Fri-Sun step back to it.
  const friday = addDays(today, 5 - isoWeekday(today));
  const sunday = addDays(friday, 2);
  return {
    periodStart: formatDate(friday),
    periodEnd: formatDate(sunday),
    startUtc: chicagoToUtc(friday),
    endUtc: chicagoToUtc(addDays(friday, 3)),
  };
}

/** Formats an instant for display in Chicago time. */
export function formatInChicago(instant: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: CHICAGO }).format(instant);
}
