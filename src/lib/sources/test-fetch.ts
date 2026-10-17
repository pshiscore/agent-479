import { mapRecord } from "@/lib/pipeline/map";
import { chicagoParts } from "@/lib/time";
import { assertTestFetchAllowed } from "./admin";
import type { IcsEvent } from "./ics";
import type { PoliteClient } from "./http";
import { fetcherFor } from "./registry";
import { type FetchResult, SourceConfigError, type SourceRow } from "./types";

/**
 * A dry-run fetch for deciding whether to enable a source (enable only after a
 * passing test fetch, with a confirmed feed URL). It is the only code path that
 * may fetch a disabled source, and only one whose disabled_reason is
 * "untested" (AGENTS.md rule 6). A person runs it, it never writes to the
 * database, and it goes through the same PoliteClient checks as the pipeline.
 */

export interface TestFetchReport {
  slug: string;
  pass: boolean;
  problems: string[];
  feedUrls: string[];
  items: number;
  withStart: number;
  recurring: number;
  upcoming: number;
  withLocation: number;
  withUrl: number;
  firstDate: string | null;
  lastDate: string | null;
  daysAhead: number | null;
  sample: { start: string; title: string }[];
  fetcherStats: Record<string, number>;
}

const isoDay = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;

interface ItemFacts {
  // Local start as written: "YYYYMMDD..." (ICS) or "YYYYMMDDTHHMMSS" built from Ticketmaster's localDate/localTime.
  start: string | null;
  title: string | null;
  hasLocation: boolean;
  recurring: boolean;
}

interface TmPayloadEvent {
  name?: string | null;
  start?: { localDate?: string | null; localTime?: string | null } | null;
  venues?: unknown[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The few facts the test summary needs, from any payload format. */
function itemFacts(payload: Record<string, unknown>): ItemFacts | null {
  if (payload.format === "jsonld") {
    const e = payload.event as { name?: string; location?: unknown } | undefined;
    if (!e) return null;
    let start: string | null = null;
    try {
      const f = mapRecord(payload, { baseUrl: "https://example.invalid/", config: {} });
      const p = chicagoParts(new Date(f.startAt));
      start = f.allDay ? `${p.year}${pad(p.month)}${pad(p.day)}` : `${p.year}${pad(p.month)}${pad(p.day)}T${pad(p.hour)}${pad(p.minute)}00`;
    } catch {
      // Unmappable: no usable start, reported as a problem.
    }
    return { start, title: e.name ?? null, hasLocation: !!e.location, recurring: false };
  }
  if (payload.format === "ticketmaster") {
    const e = payload.event as TmPayloadEvent | undefined;
    if (!e) return null;
    const date = e.start?.localDate?.replaceAll("-", "") ?? null;
    const time = e.start?.localTime?.replaceAll(":", "") ?? "";
    return {
      start: date && /^\d{8}$/.test(date) ? (time ? `${date}T${time}` : date) : null,
      title: e.name ?? null,
      hasLocation: (e.venues?.length ?? 0) > 0,
      recurring: false,
    };
  }
  const e = (payload as { event?: IcsEvent }).event;
  if (!e) return null;
  return { start: e.dtstart?.value ?? null, title: e.summary, hasLocation: !!e.location, recurring: !!e.rrule };
}

export function summarize(slug: string, result: FetchResult, today: Date): TestFetchReport {
  const p = chicagoParts(today);
  const todayKey = `${p.year}${String(p.month).padStart(2, "0")}${String(p.day).padStart(2, "0")}`;
  const events = result.items.map((i) => itemFacts(i.payload)).filter((e): e is ItemFacts => !!e);
  const starts = events.map((e) => e.start?.slice(0, 8)).filter((d): d is string => !!d && /^\d{8}$/.test(d));
  const sorted = [...starts].sort();
  const upcoming = events.filter((e) => e.recurring || (e.start && e.start.slice(0, 8) >= todayKey)).length;
  const lastDate = sorted.at(-1) ?? null;
  const daysAhead = lastDate
    ? Math.round((Date.parse(isoDay(lastDate)) - Date.parse(isoDay(todayKey))) / 86_400_000)
    : null;

  const problems: string[] = [];
  if (result.items.length === 0) problems.push("the feed has no events");
  if (starts.length < events.length) problems.push(`${events.length - starts.length} events have no usable start`);
  if (result.items.length > 0 && upcoming === 0) problems.push("no events today or later");

  return {
    slug,
    pass: problems.length === 0,
    problems,
    feedUrls: result.feedUrls,
    items: result.items.length,
    withStart: starts.length,
    recurring: events.filter((e) => e.recurring).length,
    upcoming,
    withLocation: events.filter((e) => e.hasLocation).length,
    withUrl: result.items.filter((i) => i.sourceUrl).length,
    firstDate: sorted[0] ? isoDay(sorted[0]) : null,
    lastDate: lastDate ? isoDay(lastDate) : null,
    daysAhead,
    sample: events
      .filter((e) => e.start && e.start.slice(0, 8) >= todayKey)
      .sort((a, b) => a.start!.localeCompare(b.start!))
      .slice(0, 8)
      .map((e) => ({ start: e.start!, title: e.title ?? "(no title)" })),
    fetcherStats: result.stats,
  };
}

export async function testFetch(source: SourceRow, http: PoliteClient, today = new Date()): Promise<TestFetchReport> {
  // Only untested sources: never awaiting_permission or blocked, whoever runs it.
  assertTestFetchAllowed(source);
  const fetcher = fetcherFor(source.fetcher);
  if (!source.kind || !fetcher) {
    throw new SourceConfigError(`${source.slug} has no fetcher yet; nothing to test`);
  }
  return summarize(source.slug, await fetcher.fetch(source, http), today);
}
