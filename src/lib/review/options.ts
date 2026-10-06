import { asc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/lib/db/client";
import { categories, tags, venues } from "@/lib/db/schema";
import { CODE_SET_TAGS } from "@/lib/pipeline/enrich/classify";
import { chicagoDate, formatDate } from "@/lib/time";

/** Choices for the event forms: active venues (all inside the coverage area), active categories, and the tags the owner may pick. */
export async function eventFormOptions(db: DbExecutor) {
  const [v, c, t] = await Promise.all([
    db.select({ id: venues.id, name: venues.name, city: venues.city }).from(venues).where(eq(venues.active, true)).orderBy(asc(venues.city), asc(venues.name)),
    db.select({ id: categories.id, name: categories.name, slug: categories.slug }).from(categories).where(eq(categories.active, true)).orderBy(asc(categories.sort)),
    db.select({ slug: tags.slug, name: tags.name }).from(tags).where(eq(tags.active, true)).orderBy(asc(tags.name)),
  ]);
  return { venues: v, categories: c, tags: t.filter((x) => !CODE_SET_TAGS.has(x.slug)), festivals: await festivalOptions(db) };
}

/** Festivals an event can be part of: upcoming or running multi-day events that aren't parts themselves (festivals 2b). */
export async function festivalOptions(db: DbExecutor) {
  const rows = (await db.execute(sql`
    select e.id, e.title, e.start_at, e.end_at from events e
    where e.status = 'scheduled' and e.parent_event_id is null and e.end_at is not null
      and e.end_at >= now() and (e.all_day or e.end_at - e.start_at >= interval '24 hours')
    order by e.start_at limit 200`)) as unknown as { id: string; title: string; start_at: string; end_at: string }[];
  const day = (s: string) => formatDate(chicagoDate(new Date(s)));
  return rows.map((r) => ({ id: r.id, title: r.title, firstDay: day(r.start_at), lastDay: day(r.end_at) }));
}
export type EventFormOptions = Awaited<ReturnType<typeof eventFormOptions>>;

/** Events during a festival's dates that could be its parts, with their current link (festivals 2b). */
export async function eventsDuring(db: DbExecutor, festivalId: string) {
  return (await db.execute(sql`
    select c.id, c.title, c.start_at, c.parent_event_id, v.name venue
    from events f
    join events c on c.id <> f.id and c.status = 'scheduled'
      and c.start_at >= (date_trunc('day', f.start_at at time zone 'America/Chicago') at time zone 'America/Chicago')
      and c.start_at <= coalesce(f.end_at, f.start_at)
    join venues v on v.id = c.venue_id
    where f.id = ${festivalId}
    order by (c.parent_event_id = f.id) desc nulls last, c.start_at limit 150`)) as unknown as { id: string; title: string; start_at: string; parent_event_id: string | null; venue: string }[];
}
