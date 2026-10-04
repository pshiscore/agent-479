import { sql } from "drizzle-orm";
import type { DbExecutor } from "@/lib/db/client";
import { formatInChicago } from "@/lib/time";
import { venueDisplayName } from "@/lib/venues/display";
import { type DescribeFacts, newAges, newPerformers } from "./describe";
import { priceText } from "./index";

/**
 * Rebuilds, for stored events, the facts the describe step gives the model,
 * the same way enrichRecord builds them: the event's own fields, the
 * performers from its primary source record, and the activity phrase from the
 * extraction logged with the current description. Used to check stored
 * descriptions and to re-describe events without re-running extract and
 * classify.
 */

export interface StoredEvent {
  eventId: string;
  rawRecordId: string | null;
  title: string;
  description: string | null;
  sourceDescription: string | null;
  facts: DescribeFacts;
}

interface Row {
  id: string; raw_record_id: string | null; title: string; d: string | null; source_description: string | null; start_at: Date; all_day: boolean; time_tba: boolean;
  venue: string; sub_space: string | null; city: string; category: string; is_free: boolean | null; price_min: number | null; price_max: number | null;
  age_min: number | null; age_max: number | null; grade_min: number | null; grade_max: number | null; registration_required: boolean | null;
  tags: string[] | null; performers: string[] | null; activity: string | null;
}

export async function storedEvents(db: DbExecutor, opts: { withDescription?: boolean; ids?: string[] } = {}): Promise<StoredEvent[]> {
  const rows = (await db.execute(sql`
    select e.id, es.raw_record_id, e.title, e.short_description d, r.description_text source_description, e.start_at, e.all_day, e.time_tba,
      v.name venue, e.sub_space, v.city, c.name category, e.is_free, e.price_min::float, e.price_max::float,
      e.age_min, e.age_max, e.grade_min, e.grade_max, e.registration_required,
      (select array_agg(t.name order by t.name) from event_tags et join tags t on t.id = et.tag_id where et.event_id = e.id) tags,
      array(select jsonb_array_elements_text(coalesce(r.facts->'performers', '[]'::jsonb))) performers,
      (select a.after->'_meta'->'extraction'->>'activity' from agent_actions a
        where a.entity_type = 'event' and a.entity_id = e.id and a.action in ('insert', 'update') and a.after->'_meta' ? 'extraction'
        order by a.created_at desc limit 1) activity
    from events e
    join venues v on v.id = e.venue_id
    join categories c on c.id = e.category_id
    left join event_sources es on es.event_id = e.id and es.is_primary
    left join raw_records r on r.id = es.raw_record_id
    where e.status = 'scheduled'
      ${opts.withDescription ? sql`and e.short_description is not null` : sql``}
      ${opts.ids?.length ? sql`and e.id in (${sql.join(opts.ids.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}
    order by e.start_at`)) as unknown as Row[];

  return rows.map((r) => {
    const when = formatInChicago(new Date(r.start_at), { weekday: "long", month: "long", day: "numeric", ...(r.all_day || r.time_tba ? {} : { hour: "numeric", minute: "2-digit" }) });
    return {
      eventId: r.id,
      rawRecordId: r.raw_record_id,
      title: r.title,
      description: r.d,
      sourceDescription: r.source_description,
      facts: {
        title: r.title,
        when: r.time_tba ? `${when} (time to be announced)` : r.all_day ? `${when} (all day)` : when,
        venue: venueDisplayName(r.venue, r.sub_space),
        city: r.city,
        category: r.category,
        price: priceText(r.price_min, r.price_max, r.is_free),
        tags: r.tags ?? [],
        performers: newPerformers(r.title, r.performers ?? []),
        ages: newAges(r.title, { ageMin: r.age_min, ageMax: r.age_max, gradeMin: r.grade_min, gradeMax: r.grade_max }),
        activity: r.activity,
        registrationRequired: r.registration_required,
      },
    };
  });
}
