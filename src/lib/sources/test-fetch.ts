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

export function summarize(slug: string, result: FetchResult, today: Date): TestFetchReport {
  const p = chicagoParts(today);
  const todayKey = `${p.year}${String(p.month).padStart(2, "0")}${String(p.day).padStart(2, "0")}`;
  const events = result.items.map((i) => (i.payload as { event?: IcsEvent }).event).filter((e): e is IcsEvent => !!e);
  const starts = events.map((e) => e.dtstart?.value.slice(0, 8)).filter((d): d is string => !!d && /^\d{8}$/.test(d));
  const sorted = [...starts].sort();
  const upcoming = events.filter((e) => e.rrule || (e.dtstart && e.dtstart.value.slice(0, 8) >= todayKey)).length;
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
    recurring: events.filter((e) => e.rrule).length,
    upcoming,
    withLocation: events.filter((e) => e.location).length,
    withUrl: events.filter((e) => e.url).length,
    firstDate: sorted[0] ? isoDay(sorted[0]) : null,
    lastDate: lastDate ? isoDay(lastDate) : null,
    daysAhead,
    sample: events
      .filter((e) => e.dtstart && e.dtstart.value.slice(0, 8) >= todayKey)
      .sort((a, b) => a.dtstart!.value.localeCompare(b.dtstart!.value))
      .slice(0, 8)
      .map((e) => ({ start: e.dtstart!.value, title: e.summary ?? "(no title)" })),
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
