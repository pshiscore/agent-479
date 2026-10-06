import { sql } from "drizzle-orm";
import { TAG_ORDER } from "@/config/front-page";
import type { DbExecutor } from "@/lib/db/client";
import { applyLinkPolicy, type LinkPolicy, loadLinkPolicies } from "@/lib/links";
import { slugify } from "@/lib/slug";
import { chicagoDate, chicagoToUtc, formatDate, parseDate } from "@/lib/time";
import { sourceVisible } from "./visibility";

/**
 * Read-only queries behind the public pages (docs/product/front-page.md).
 * Public code: never reads the fetch staging table or source descriptions
 * (tests/raw-records-isolation.test.ts checks).
 * Every event list goes through listEvents, so filters, the recurring-series
 * folding, link policies, and the Ticketmaster display gate apply everywhere.
 */

export interface Filters {
  city?: string; // city slug
  category?: string; // category slug
  tags?: string[]; // tag slugs, all required
  venueType?: string;
  venue?: string; // venue slug
  showRecurring?: boolean;
  id?: string; // one event (the feature card)
}

export interface EventItem {
  id: string;
  slug: string;
  title: string;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  timeTba: boolean;
  venue: { slug: string; name: string; type: string };
  subSpace: string | null;
  city: { slug: string; name: string };
  category: { slug: string; name: string };
  tags: { slug: string; name: string }[];
  shortDescription: string | null;
  ageMin: number | null;
  ageMax: number | null;
  gradeMin: number | null;
  gradeMax: number | null;
  moreInfoUrl: string | null;
  ticketUrl: string | null;
  source: string;
  series: { id: string; kind: string; label: string; title: string } | null;
  // Per-day hours of a multi-day event, when stated (event_days).
  days: { day: string; opensAt: Date | null; closesAt: Date | null }[];
  // Festivals 2b: the festival this is part of, and a festival's own parts.
  parent: { id: string; title: string } | null;
  parts: { title: string; startAt: Date }[];
}

export interface SeriesRow {
  id: string;
  title: string;
  label: string;
  venue: { slug: string; name: string };
  city: { slug: string; name: string };
  category: { slug: string; name: string };
  next: EventItem;
  occurrences: number;
}

interface Row {
  id: string; slug: string; title: string; start_at: string; end_at: string | null; all_day: boolean; time_tba: boolean;
  venue_slug: string; venue_name: string; venue_type: string; sub_space: string | null; city: string;
  category_slug: string; category_name: string; short_description: string | null;
  age_min: number | null; age_max: number | null; grade_min: number | null; grade_max: number | null;
  primary_source_url: string | null; ticket_url: string | null; source: string;
  series_id: string | null; series_kind: string | null; series_label: string | null; series_title: string | null; series_active: boolean | null;
  tags: { slug: string; name: string }[] | null;
  days: { day: string; opens_at: string | null; closes_at: string | null }[] | null;
  parent_id: string | null; parent_title: string | null;
  parts: { title: string; start_at: string; source: string }[] | null;
}

const chicagoDay = (d: Date) => formatDate(chicagoDate(d));

const tagRank = (slug: string) => {
  const i = (TAG_ORDER as readonly string[]).indexOf(slug);
  return i < 0 ? 99 : i;
};

function toItem(r: Row, policies: LinkPolicy[]): EventItem {
  const more = r.primary_source_url ? applyLinkPolicy(r.primary_source_url, policies) : null;
  const tickets = r.ticket_url ? applyLinkPolicy(r.ticket_url, policies) : null;
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    startAt: new Date(r.start_at),
    endAt: r.end_at ? new Date(r.end_at) : null,
    allDay: r.all_day,
    timeTba: r.time_tba,
    venue: { slug: r.venue_slug, name: r.venue_name, type: r.venue_type },
    subSpace: r.sub_space,
    city: { slug: slugify(r.city), name: r.city },
    category: { slug: r.category_slug, name: r.category_name },
    tags: [...(r.tags ?? [])].sort((a, b) => tagRank(a.slug) - tagRank(b.slug)),
    shortDescription: r.short_description,
    ageMin: r.age_min,
    ageMax: r.age_max,
    gradeMin: r.grade_min,
    gradeMax: r.grade_max,
    moreInfoUrl: more,
    // Shown separately only when it isn't the same page as "More info".
    ticketUrl: tickets && tickets !== more ? tickets : r.source === "ticketmaster" ? tickets : null,
    source: r.source,
    series: r.series_id && r.series_active ? { id: r.series_id, kind: r.series_kind!, label: r.series_label!, title: r.series_title! } : null,
    days: (r.days ?? []).map((d) => ({ day: d.day, opensAt: d.opens_at ? new Date(d.opens_at) : null, closesAt: d.closes_at ? new Date(d.closes_at) : null })),
    parent: r.parent_id && r.parent_title ? { id: r.parent_id, title: r.parent_title } : null,
    // Parts from sources that can't be shown publicly (Ticketmaster, for now) aren't named either.
    parts: (r.parts ?? []).filter((p) => sourceVisible(p.source)).map((p) => ({ title: p.title, startAt: new Date(p.start_at) })),
  };
}

/**
 * Scheduled events running at any point in [from, to) (a festival that
 * started yesterday is still listed), filtered, soonest first.
 * Recurring-series occurrences included.
 */
export async function listEvents(db: DbExecutor, range: { from: Date; to: Date }, f: Filters = {}): Promise<EventItem[]> {
  const tagSlugs = f.tags?.filter(Boolean) ?? [];
  const rows = (await db.execute(sql`
    select e.id, e.slug, e.title, e.start_at, e.end_at, e.all_day, e.time_tba,
      v.slug venue_slug, v.name venue_name, v.venue_type, e.sub_space, v.city,
      c.slug category_slug, c.name category_name, e.short_description,
      e.age_min, e.age_max, e.grade_min, e.grade_max, e.primary_source_url, e.ticket_url, s.slug source,
      e.series_id, ser.kind series_kind, ser.recurrence_label series_label, ser.title series_title, ser.active series_active,
      (select json_agg(json_build_object('slug', t.slug, 'name', t.name)) from event_tags et join tags t on t.id = et.tag_id
        where et.event_id = e.id and t.active) tags,
      (select json_agg(json_build_object('day', d.day, 'opens_at', d.opens_at, 'closes_at', d.closes_at) order by d.day) from event_days d
        where d.event_id = e.id) days,
      pe.id parent_id, pe.title parent_title,
      (select json_agg(json_build_object('title', ch.title, 'start_at', ch.start_at, 'source', chs.slug) order by ch.start_at) from events ch
        join event_sources ches on ches.event_id = ch.id and ches.is_primary join sources chs on chs.id = ches.source_id
        where ch.parent_event_id = e.id and ch.status = 'scheduled') parts
    from events e
    join venues v on v.id = e.venue_id
    join categories c on c.id = e.category_id
    join event_sources es on es.event_id = e.id and es.is_primary
    join sources s on s.id = es.source_id
    left join event_series ser on ser.id = e.series_id
    left join events pe on pe.id = e.parent_event_id and pe.status in ('scheduled', 'postponed')
    where e.status = 'scheduled'
      and e.start_at < ${range.to.toISOString()}::timestamptz and coalesce(e.end_at, e.start_at) >= ${range.from.toISOString()}::timestamptz
      ${f.id ? sql`and e.id = ${f.id}::uuid` : sql``}
      ${f.category ? sql`and c.slug = ${f.category}` : sql``}
      ${f.venue ? sql`and v.slug = ${f.venue}` : sql``}
      ${f.venueType ? sql`and v.venue_type = ${f.venueType}` : sql``}
      ${tagSlugs.length ? sql`and (select count(distinct t.slug) from event_tags et join tags t on t.id = et.tag_id where et.event_id = e.id and t.slug in (${sql.join(tagSlugs.map((t) => sql`${t}`), sql`, `)})) = ${tagSlugs.length}` : sql``}
    order by e.start_at, e.title`)) as unknown as Row[];
  const policies = await loadLinkPolicies(db);
  return rows
    .filter((r) => sourceVisible(r.source))
    .map((r) => toItem(r, policies))
    .filter((e) => !f.city || e.city.slug === f.city);
}

/**
 * Splits a list for display: with recurring hidden (the default), occurrences
 * of active recurring series fold into one row per series ("Storytime,
 * Tuesdays, next: Oct 6"); runs and one-offs stay as events.
 */
export function foldRecurring(items: EventItem[], showRecurring: boolean): { events: EventItem[]; series: SeriesRow[] } {
  if (showRecurring) return { events: items, series: [] };
  const events: EventItem[] = [];
  const byId = new Map<string, SeriesRow>();
  for (const e of items) {
    if (e.series?.kind !== "recurring") {
      events.push(e);
      continue;
    }
    const row = byId.get(e.series.id);
    if (row) row.occurrences++;
    else byId.set(e.series.id, { id: e.series.id, title: e.series.title, label: e.series.label, venue: e.venue, city: e.city, category: e.category, next: e, occurrences: 1 });
  }
  return { events, series: [...byId.values()] };
}

/** Groups events by Chicago calendar day (a placed multi-day event by its listed day), in order. */
export function byDay<T extends EventItem & { placement?: { day: string } }>(items: T[]): { day: string; date: Date; items: T[] }[] {
  const out = new Map<string, { day: string; date: Date; items: T[] }>();
  for (const e of items) {
    const key = e.placement?.day ?? chicagoDay(e.startAt);
    // Noon Chicago time names the day safely for headings.
    if (!out.has(key)) out.set(key, { day: key, date: chicagoToUtc(parseDate(key), { hour: 12 }), items: [] });
    out.get(key)!.items.push(e);
  }
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** "This weekend" variety (B2): at most `perVenue` per venue and `total` overall, keeping a spread of categories. */
export function weekendVariety<T extends EventItem>(items: T[], limits: { perVenue: number; total: number }): { shown: T[]; hidden: number } {
  const perVenue = new Map<string, number>();
  const capped = items.filter((e) => {
    const n = (perVenue.get(e.venue.slug) ?? 0) + 1;
    perVenue.set(e.venue.slug, n);
    return n <= limits.perVenue;
  });
  if (capped.length <= limits.total) return { shown: capped, hidden: items.length - capped.length };
  // Round-robin over categories, so one busy category can't fill the list.
  const queues = new Map<string, T[]>();
  for (const e of capped) queues.set(e.category.slug, [...(queues.get(e.category.slug) ?? []), e]);
  const picked: T[] = [];
  while (picked.length < limits.total) {
    let took = false;
    for (const q of queues.values()) {
      const e = q.shift();
      if (e && picked.length < limits.total) {
        picked.push(e);
        took = true;
      }
    }
    if (!took) break;
  }
  // Keep the incoming order (placeInView sorts a continuing festival by the day it's listed under).
  picked.sort((a, b) => items.indexOf(a) - items.indexOf(b));
  return { shown: picked, hidden: items.length - picked.length };
}

/** One upcoming event by id, through the same filters and gates as every list. */
export async function eventById(db: DbExecutor, id: string, now: Date): Promise<EventItem | null> {
  const [item] = await listEvents(db, { from: now, to: new Date(now.getTime() + 400 * 86_400_000) }, { id });
  return item ?? null;
}

/** Filter options: cities and categories with upcoming events, and venue types in use. */
export async function filterOptions(db: DbExecutor) {
  const cities = (await db.execute(sql`
    select distinct v.city from events e join venues v on v.id = e.venue_id where e.status = 'scheduled' and e.start_at >= now() order by 1`)) as unknown as { city: string }[];
  const categories = (await db.execute(sql`select slug, name from categories where active order by sort`)) as unknown as { slug: string; name: string }[];
  const tags = (await db.execute(sql`select slug, name from tags where active`)) as unknown as { slug: string; name: string }[];
  return {
    cities: cities.map((c) => ({ slug: slugify(c.city), name: c.city })),
    categories,
    tags: tags.sort((a, b) => tagRank(a.slug) - tagRank(b.slug)),
  };
}

export async function venueBySlug(db: DbExecutor, slug: string) {
  const [v] = (await db.execute(sql`select slug, name, venue_type, address, city, postal_code, website from venues where slug = ${slug} and active`)) as unknown as {
    slug: string; name: string; venue_type: string; address: string | null; city: string; postal_code: string | null; website: string | null;
  }[];
  return v ?? null;
}

export async function categoryBySlug(db: DbExecutor, slug: string) {
  const [c] = (await db.execute(sql`select slug, name from categories where slug = ${slug} and active`)) as unknown as { slug: string; name: string }[];
  return c ?? null;
}

export async function cityBySlug(db: DbExecutor, slug: string) {
  const rows = (await db.execute(sql`select distinct city from venues where active`)) as unknown as { city: string }[];
  const c = rows.find((r) => slugify(r.city) === slug);
  return c ? { slug, name: c.city } : null;
}

/** Slugs of cities with a city page (cities that have venues), so other pages link only to ones that exist. */
export async function citySlugs(db: DbExecutor): Promise<Set<string>> {
  const rows = (await db.execute(sql`select distinct city from venues where active`)) as unknown as { city: string }[];
  return new Set(rows.map((r) => slugify(r.city)));
}

export async function venuesByCity(db: DbExecutor, now: Date) {
  const rows = (await db.execute(sql`
    select v.slug, v.name, v.city, v.venue_type,
      (select count(*)::int from events e where e.venue_id = v.id and e.status = 'scheduled' and e.start_at >= ${now.toISOString()}::timestamptz) upcoming
    from venues v where v.active
    order by v.city, v.name`)) as unknown as { slug: string; name: string; city: string; venue_type: string; upcoming: number }[];
  const out = new Map<string, typeof rows>();
  for (const r of rows) out.set(r.city, [...(out.get(r.city) ?? []), r]);
  return [...out.entries()].map(([city, venues]) => ({ city: { slug: slugify(city), name: city }, venues }));
}
