import { createHash } from "node:crypto";

/**
 * A small RFC 5545 reader for event feeds. It reads a whitelist of VEVENT
 * properties: the facts, plus DESCRIPTION, which is internal staging for
 * extraction only (AGENTS.md rule 4) and is kept out of the payload by the
 * fetcher. Other free text (X-ALT-DESC, COMMENT, ATTACH...) is ignored. Times
 * are kept exactly as written (value, TZID, date-only flag); converting them to
 * UTC is the mapper's job (step 12), with an explicit zone.
 */

export interface IcsTime {
  // As written, e.g. "20261010T190000", "20261010T190000Z", or "20261010".
  value: string;
  tzid?: string;
  isDate: boolean;
}

export interface IcsEvent {
  uid: string | null;
  recurrenceId: IcsTime | null;
  summary: string | null;
  // Internal only: never displayed or published, purged after the event ends.
  description: string | null;
  dtstart: IcsTime | null;
  dtend: IcsTime | null;
  duration: string | null;
  rrule: string | null;
  rdate: IcsTime[];
  exdate: IcsTime[];
  location: string | null;
  geo: { lat: number; lng: number } | null;
  url: string | null;
  status: string | null;
  categories: string[];
  sequence: number | null;
  lastModified: string | null;
}

export interface IcsCalendar {
  // X-WR-TIMEZONE, the feed's default zone for floating times, if declared.
  defaultTimezone: string | null;
  // TZIDs defined by VTIMEZONE blocks in the feed.
  timezones: string[];
  events: IcsEvent[];
}

export class IcsParseError extends Error {}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Joins folded lines: a line starting with a space or tab continues the previous one. */
export function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter((l) => l.length > 0);
}

/** NAME;PARAM=a;PARAM2="b;c":value. Quoted param values may contain ; : and ,. */
export function parseLine(line: string): ContentLine | null {
  let i = 0;
  const nameMatch = /^[A-Za-z0-9-]+/.exec(line);
  if (!nameMatch) return null;
  const name = nameMatch[0].toUpperCase();
  i = name.length;
  const params: Record<string, string> = {};
  while (line[i] === ";") {
    i++;
    const eq = line.indexOf("=", i);
    if (eq < 0) return null;
    const key = line.slice(i, eq).toUpperCase();
    i = eq + 1;
    let val = "";
    if (line[i] === '"') {
      const close = line.indexOf('"', i + 1);
      if (close < 0) return null;
      val = line.slice(i + 1, close);
      i = close + 1;
    } else {
      const m = /^[^;:]*/.exec(line.slice(i))!;
      val = m[0];
      i += val.length;
    }
    params[key] = val;
  }
  if (line[i] !== ":") return null;
  return { name, params, value: line.slice(i + 1) };
}

// Windows-1252's characters for bytes 0x80-0x9F (index = byte - 0x80); "" where undefined.
const CP1252_C1 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

/**
 * Some feeds (seen in Communico's) carry text that went through Windows-1252
 * upstream, leaving C1 control characters (U+0080-U+009F) where punctuation
 * belongs: "Ages 0\u009624" for "Ages 0–24". Real text never contains C1
 * controls, so mapping them back to their Windows-1252 characters is safe.
 */
export function repairCp1252(v: string): string {
  return v.replace(/[\u0080-\u009f]/g, (c) => {
    const fixed = CP1252_C1[c.charCodeAt(0) - 0x80];
    return fixed && fixed.charCodeAt(0) > 0x9f ? fixed : "";
  });
}

/** TEXT values: \\ \; \, and \n are escapes. */
export function unescapeText(v: string): string {
  return repairCp1252(v).replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** Splits a TEXT list on unescaped commas. */
function splitTextList(v: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < v.length; i++) {
    if (v[i] === "\\" && i + 1 < v.length) {
      cur += v[i] + v[i + 1];
      i++;
    } else if (v[i] === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += v[i];
    }
  }
  out.push(cur);
  return out.map(unescapeText).map((s) => s.trim()).filter(Boolean);
}

function toTime(line: ContentLine): IcsTime {
  const value = line.value.trim();
  const isDate = line.params.VALUE === "DATE" || /^\d{8}$/.test(value);
  return { value, ...(line.params.TZID ? { tzid: line.params.TZID } : {}), isDate };
}

function toTimes(line: ContentLine): IcsTime[] {
  return line.value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((value) => toTime({ ...line, value }));
}

const emptyEvent = (): IcsEvent => ({
  uid: null,
  recurrenceId: null,
  summary: null,
  description: null,
  dtstart: null,
  dtend: null,
  duration: null,
  rrule: null,
  rdate: [],
  exdate: [],
  location: null,
  geo: null,
  url: null,
  status: null,
  categories: [],
  sequence: null,
  lastModified: null,
});

/** Applies one whitelisted property. Anything else (X-ALT-DESC, COMMENT, ATTACH...) is ignored. */
function applyProperty(e: IcsEvent, line: ContentLine): void {
  switch (line.name) {
    case "UID":
      e.uid = line.value.trim() || null;
      break;
    case "RECURRENCE-ID":
      e.recurrenceId = toTime(line);
      break;
    case "SUMMARY":
      e.summary = unescapeText(line.value).trim() || null;
      break;
    case "DESCRIPTION":
      e.description = unescapeText(line.value).trim() || null;
      break;
    case "DTSTART":
      e.dtstart = toTime(line);
      break;
    case "DTEND":
      e.dtend = toTime(line);
      break;
    case "DURATION":
      e.duration = line.value.trim() || null;
      break;
    case "RRULE":
      e.rrule = line.value.trim() || null;
      break;
    case "RDATE":
      e.rdate.push(...toTimes(line));
      break;
    case "EXDATE":
      e.exdate.push(...toTimes(line));
      break;
    case "LOCATION":
      e.location = unescapeText(line.value).trim() || null;
      break;
    case "GEO": {
      const [lat, lng] = line.value.split(/[;,]/).map(Number);
      e.geo = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
      break;
    }
    case "URL":
      e.url = /^https?:\/\//i.test(line.value.trim()) ? line.value.trim() : null;
      break;
    case "STATUS":
      e.status = line.value.trim().toUpperCase() || null;
      break;
    case "CATEGORIES":
      e.categories.push(...splitTextList(line.value));
      break;
    case "SEQUENCE": {
      const n = Number.parseInt(line.value, 10);
      e.sequence = Number.isFinite(n) ? n : null;
      break;
    }
    case "LAST-MODIFIED":
      e.lastModified = line.value.trim() || null;
      break;
  }
}

export function parseIcs(text: string, opts: { maxEvents?: number } = {}): IcsCalendar {
  const maxEvents = opts.maxEvents ?? 5_000;
  const lines = unfold(text);
  if (!lines[0] || lines[0].trim().toUpperCase() !== "BEGIN:VCALENDAR") {
    throw new IcsParseError("not an iCalendar file (no BEGIN:VCALENDAR)");
  }
  const cal: IcsCalendar = { defaultTimezone: null, timezones: [], events: [] };
  const stack: string[] = [];
  let current: IcsEvent | null = null;

  for (const raw of lines) {
    const line = parseLine(raw);
    if (!line) continue;
    if (line.name === "BEGIN") {
      const comp = line.value.trim().toUpperCase();
      stack.push(comp);
      // Only top-level events: a VEVENT can't nest, but VALARM can sit inside one.
      if (comp === "VEVENT" && stack.length === 2) current = emptyEvent();
      continue;
    }
    if (line.name === "END") {
      const comp = line.value.trim().toUpperCase();
      if (stack.at(-1) !== comp) throw new IcsParseError(`END:${comp} doesn't match BEGIN:${stack.at(-1) ?? "nothing"}`);
      stack.pop();
      if (comp === "VEVENT" && current && stack.length === 1) {
        cal.events.push(current);
        if (cal.events.length > maxEvents) throw new IcsParseError(`more than ${maxEvents} events`);
        current = null;
      }
      continue;
    }
    const where = stack.at(-1);
    if (where === "VEVENT" && current) applyProperty(current, line);
    else if (where === "VCALENDAR" && line.name === "X-WR-TIMEZONE") cal.defaultTimezone = line.value.trim() || null;
    else if (where === "VTIMEZONE" && line.name === "TZID") cal.timezones.push(line.value.trim());
  }
  if (stack.length > 0) throw new IcsParseError(`unclosed ${stack.at(-1)}`);
  return cal;
}

/**
 * A stable id for an event within its source: the UID, plus RECURRENCE-ID for
 * an overridden occurrence of a recurring event. Events without a UID (rare,
 * and invalid) fall back to a hash of title and start.
 */
export function icsExternalId(e: IcsEvent): string {
  const base =
    e.uid ??
    `nouid:${createHash("sha256")
      .update(`${e.summary ?? ""}|${e.dtstart?.value ?? ""}|${e.dtstart?.tzid ?? ""}`)
      .digest("hex")
      .slice(0, 32)}`;
  return e.recurrenceId ? `${base}|${e.recurrenceId.value}` : base;
}

const DAY_MS = 86_400_000;

/** "20261010..." → that calendar date at UTC midnight, or null. */
function dateOf(value: string | undefined): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value ?? "");
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

/**
 * When an event's description must be purged: 30 days after it ends, plus a
 * day of slack because the time zone isn't resolved here. For a recurring
 * event, that's after its UNTIL; an open-ended series returns null, and the
 * purge job then uses 30 days after the item was last seen in the feed.
 */
export function icsDescriptionPurgeAfter(e: IcsEvent): Date | null {
  let end: Date | null;
  if (e.rrule) {
    end = dateOf(/(?:^|;)UNTIL=([0-9TZ]+)/.exec(e.rrule)?.[1]);
  } else {
    end = dateOf(e.dtend?.value ?? e.dtstart?.value);
  }
  return end ? new Date(end.getTime() + 31 * DAY_MS) : null;
}
