import { chicagoToUtc } from "@/lib/time";
import { MapError } from "./facts";

/**
 * Converting source times to UTC. Every source we read publishes in Chicago
 * time; anything else fails the record rather than guessing (AGENTS.md rule 5).
 */

// IANA names, legacy aliases, and the Windows names some ICS producers write.
const CHICAGO_ZONES = new Set(
  ["America/Chicago", "US/Central", "CST6CDT", "Central Standard Time", "Central Time (US & Canada)", "(UTC-06:00) Central Time (US & Canada)"].map(
    (z) => z.toLowerCase(),
  ),
);

export const isChicagoZone = (tz: string | null | undefined) => !!tz && CHICAGO_ZONES.has(tz.trim().toLowerCase());

const ICS_VALUE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/;

/** An ICS date or date-time as an instant. Date-only values are Chicago midnight. */
export function icsInstant(
  t: { value: string; tzid?: string; isDate: boolean },
  feedDefaultTz: string | null,
): { at: Date; allDay: boolean; assumed: boolean } {
  const m = ICS_VALUE.exec(t.value.trim());
  if (!m) throw new MapError(`unreadable ICS time "${t.value}"`);
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (t.isDate || m[4] === undefined) return { at: chicagoToUtc(date), allDay: true, assumed: false };
  const time = { hour: Number(m[4]), minute: Number(m[5]), second: Number(m[6] ?? 0) };
  if (m[7] === "Z") {
    return { at: new Date(Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second)), allDay: false, assumed: false };
  }
  const zone = t.tzid ?? feedDefaultTz;
  if (zone && !isChicagoZone(zone)) throw new MapError(`unsupported time zone "${zone}"`);
  return { at: chicagoToUtc(date, time), allDay: false, assumed: !zone };
}

/** ISO 8601 durations as ICS writes them: P1D, PT2H30M, P1W, P1DT2H. */
export function durationMs(d: string): number {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(d.trim());
  if (!m) throw new MapError(`unreadable duration "${d}"`);
  const [w, dd, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
  return ((((w * 7 + dd) * 24 + h) * 60 + mi) * 60 + s) * 1000;
}

/** "2026-10-10" and "19:00:00" in Chicago as an instant. */
export function chicagoLocal(localDate: string, localTime: string | null): Date {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!d) throw new MapError(`unreadable date "${localDate}"`);
  const date = { year: Number(d[1]), month: Number(d[2]), day: Number(d[3]) };
  if (!localTime) return chicagoToUtc(date);
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localTime);
  if (!t) throw new MapError(`unreadable time "${localTime}"`);
  return chicagoToUtc(date, { hour: Number(t[1]), minute: Number(t[2]), second: Number(t[3] ?? 0) });
}
