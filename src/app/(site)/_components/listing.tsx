import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { filterQuery, parseFilters } from "@/lib/site/filters";
import { byDay, type Filters, filterOptions, foldRecurring, listEvents } from "@/lib/site/queries";
import { chicagoToUtc, parseDate } from "@/lib/time";
import { DayTimeline, SeriesRows } from "./events";
import { FilterBar } from "./filter-bar";
import { isoDay, shortDate } from "./format";

/**
 * Every "events by day" page (Upcoming, city, venue, category): the filter
 * bar, then events grouped by day for a date range, with recurring programs
 * folded into series rows unless "Show recurring" is on (B6).
 * Range: ?from=YYYY-MM-DD (default today) and ?days=N (1 to 31, default 14).
 */

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const DAY = 86_400_000;

export function rangeFrom(p: Params, now: Date) {
  const fromParam = one(p.from);
  const today = isoDay(now);
  const fromDay = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) && fromParam >= today ? fromParam : today;
  const days = Math.min(31, Math.max(1, Number(one(p.days)) || 14));
  const startOfDay = chicagoToUtc(parseDate(fromDay));
  const from = new Date(Math.max(startOfDay.getTime(), now.getTime()));
  const to = new Date(startOfDay.getTime() + days * DAY);
  return { fromDay, days, from, to };
}

export async function Listing({
  path,
  params,
  fixed = {},
  heading,
  subheading,
  hide = [],
}: {
  path: string;
  params: Params;
  fixed?: Filters;
  heading: string;
  subheading?: React.ReactNode;
  hide?: ("city" | "category" | "venueType")[];
}) {
  const db = getDb();
  const now = new Date();
  const userFilters = parseFilters(params);
  const filters: Filters = { ...userFilters, ...fixed };
  const { fromDay, days, from, to } = rangeFrom(params, now);
  const [items, options] = [await listEvents(db, { from, to }, filters), await filterOptions(db)];
  const { events, series } = foldRecurring(items, Boolean(filters.showRecurring));
  const nextFrom = isoDay(to);

  return (
    <>
      <FilterBar action={path} filters={userFilters} options={options} hide={hide} />
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <h1 className="font-display text-4xl font-extrabold text-brand">{heading}</h1>
        {subheading && <div className="mt-2 text-muted">{subheading}</div>}
        <p className="mt-2 text-sm text-muted">
          {shortDate(from)} to {shortDate(new Date(to.getTime() - DAY))} · {items.length} event{items.length === 1 ? "" : "s"}
          {!filters.showRecurring && series.length > 0 ? ` (${series.length} weekly or recurring programs shown once)` : ""}
        </p>
        <SeriesRows series={series} />
        {events.length === 0 && series.length === 0 && <p className="mt-8 text-muted">Nothing listed for these dates and filters.</p>}
        {byDay(events).map((d) => (
          <DayTimeline key={d.day} date={d.date} items={d.items} />
        ))}
        <nav className="mt-8 flex gap-4 text-sm font-semibold">
          {fromDay > isoDay(now) && (
            <Link href={`${path}${filterQuery(userFilters, { from: isoDay(new Date(chicagoToUtc(parseDate(fromDay)).getTime() - days * DAY)), days: String(days) })}`} className="underline underline-offset-4">
              Earlier
            </Link>
          )}
          <Link href={`${path}${filterQuery(userFilters, { from: nextFrom, days: String(days) })}`} className="underline underline-offset-4">
            Later
          </Link>
        </nav>
      </div>
    </>
  );
}
