import { addDays, type CalendarDate, formatDate, isoWeekday, parseDate } from "@/lib/time";

/**
 * The benchmark's input (docs/product/organizers.md): one event per line, a
 * name and a date in any common order, typed by the owner from a roundup.
 *   Fall Festivities, Oct 16
 *   Sat Oct 18 - Harvest Market
 *   10/18 Harvest Market
 *   2026-10-18 Harvest Market
 *   Harvest Market, Saturday        (a weekday alone means that day of the benchmark week)
 * A range ("Oct 17-19") keeps its first day; a multi-day event matches when
 * that day falls inside its dates. The year is the one nearest the week.
 */

export interface ParsedLine {
  name: string;
  date: string; // YYYY-MM-DD
}
export interface LineError {
  line: string;
  problem: string;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
// Whole month names or their abbreviations only, so "Market" isn't March.
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?![a-z])`;
const DAY_NAME = String.raw`(mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\.?(?![a-z])`;
// A weekday before a date is part of the date only at the start or after a separator ("First Friday, Jan 1" keeps its name).
const WEEKDAY = String.raw`(?:(?<=^|[,|:;–—\-•(]\s*)${DAY_NAME.replace("(mon", "(?:mon")},?\s+)?`;

const PATTERNS: { re: RegExp; read: (m: RegExpExecArray) => { month: number; day: number; year?: number } }[] = [
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, read: (m) => ({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }) },
  {
    re: new RegExp(String.raw`${WEEKDAY}\b${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:\s*[-–—]\s*(?:${MONTH}\s+)?\d{1,2}(?:st|nd|rd|th)?\b)?(?:,?\s+(\d{4})\b)?`, "i"),
    read: (m) => ({ month: MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, day: Number(m[2]), year: m[4] ? Number(m[4]) : undefined }),
  },
  {
    re: new RegExp(String.raw`${WEEKDAY}\b(\d{1,2})/(\d{1,2})(?:/(\d{2}|\d{4}))?(?:\s*[-–—]\s*\d{1,2}(?:/\d{1,2})?)?(?![\d/])`, "i"),
    read: (m) => ({ month: Number(m[1]), day: Number(m[2]), year: m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : undefined }),
  },
];
const WEEKDAY_ONLY = new RegExp(String.raw`\b${DAY_NAME}`, "i");

const valid = (d: CalendarDate) => {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day));
  return d.month >= 1 && d.month <= 12 && t.getUTCMonth() === d.month - 1 && t.getUTCDate() === d.day;
};

/** The year that puts month/day nearest the week. */
function nearestYear(month: number, day: number, week: CalendarDate): number {
  const at = (y: number) => Math.abs(Date.UTC(y, month - 1, day) - Date.UTC(week.year, week.month - 1, week.day));
  return [week.year - 1, week.year, week.year + 1].reduce((best, y) => (at(y) < at(best) ? y : best));
}

const tidy = (s: string) => s.replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").replace(/^[\s,|:;–—\-•*·]+|[\s,|:;–—\-•*·(]+$/g, "").trim();

export function parseLine(raw: string, weekStart: string): ParsedLine | LineError {
  const line = raw.trim();
  const week = parseDate(weekStart);
  for (const { re, read } of PATTERNS) {
    const m = re.exec(line);
    if (!m) continue;
    const r = read(m);
    const date = { year: r.year ?? nearestYear(r.month, r.day, week), month: r.month, day: r.day };
    if (!valid(date)) return { line, problem: "that date doesn't exist" };
    return named(line, line.slice(0, m.index) + " " + line.slice(m.index + m[0].length), formatDate(date));
  }
  const w = WEEKDAY_ONLY.exec(line);
  if (w) {
    const date = addDays(week, WEEKDAYS.indexOf(w[1].toLowerCase()) - (isoWeekday(week) - 1));
    return named(line, line.slice(0, w.index) + " " + line.slice(w.index + w[0].length), formatDate(date));
  }
  return { line, problem: "no date found" };
}

function named(line: string, rest: string, date: string): ParsedLine | LineError {
  const name = tidy(rest);
  if (name.length < 2) return { line, problem: "no event name" };
  if (name.length > 300) return { line, problem: "name over 300 characters" };
  return { name, date };
}

/** Every non-blank line (lines starting with # are notes and skipped), split into parsed items and errors. Exact repeats are dropped. */
export function parseLines(text: string, weekStart: string): { items: ParsedLine[]; errors: LineError[] } {
  const items: ParsedLine[] = [];
  const errors: LineError[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const r = parseLine(raw, weekStart);
    if ("problem" in r) {
      errors.push(r);
      continue;
    }
    const key = `${r.name.toLowerCase()}|${r.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(r);
  }
  return { items, errors };
}

/** The Monday of the week containing a date. */
export const mondayOf = (date: string) => {
  const d = parseDate(date);
  return formatDate(addDays(d, 1 - isoWeekday(d)));
};
