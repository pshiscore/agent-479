/**
 * Runs the content checks (evaluative words, grounding) over every stored
 * description, read-only, and reports what they'd flag. The facts are rebuilt
 * the way the enrich stage gives them to the model.
 *
 * Usage: npm run check:descriptions [-- --examples 5]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { factsForChecks } from "@/lib/pipeline/enrich/describe";
import { priceText } from "@/lib/pipeline/enrich/index";
import { contentIssues, describeIssues } from "@/lib/text/checks";
import { formatInChicago } from "@/lib/time";
import { venueDisplayName } from "@/lib/venues/display";

const { values: args } = parseArgs({ options: { examples: { type: "string", default: "5" } } });

interface Row {
  id: string; title: string; d: string; start_at: Date; all_day: boolean; time_tba: boolean; venue: string; sub_space: string | null; city: string;
  category: string; is_free: boolean | null; price_min: number | null; price_max: number | null; age_min: number | null; age_max: number | null;
  grade_min: number | null; grade_max: number | null; registration_required: boolean | null; tags: string[] | null; performers: string[] | null; activity: string | null;
}

const range = (label: string, min: number | null, max: number | null) =>
  min !== null && max !== null ? `${label} ${min}–${max}` : min !== null ? `${label} ${min} and up` : max !== null ? `${label} up to ${max}` : null;

async function main() {
  const db = getDb();
  try {
    const rows = (await db.execute(sql`
      select e.id, e.title, e.short_description d, e.start_at, e.all_day, e.time_tba, v.name venue, e.sub_space, v.city, c.name category,
        e.is_free, e.price_min::float, e.price_max::float, e.age_min, e.age_max, e.grade_min, e.grade_max, e.registration_required,
        (select array_agg(t.name) from event_tags et join tags t on t.id = et.tag_id where et.event_id = e.id) tags,
        (select array(select jsonb_array_elements_text(r.facts->'performers')) from event_sources es join raw_records r on r.id = es.raw_record_id where es.event_id = e.id and es.is_primary) performers,
        (select a.after->'_meta'->'extraction'->>'activity' from agent_actions a where a.entity_type = 'event' and a.entity_id = e.id and a.action in ('insert','update') and a.after->>'shortDescription' = e.short_description order by a.created_at desc limit 1) activity
      from events e join venues v on v.id = e.venue_id join categories c on c.id = e.category_id
      where e.short_description is not null`)) as unknown as Row[];

    const flagged: { title: string; d: string; why: string; evaluative: boolean; grounding: boolean }[] = [];
    for (const r of rows) {
      const when = formatInChicago(new Date(r.start_at), { weekday: "long", month: "long", day: "numeric", ...(r.all_day || r.time_tba ? {} : { hour: "numeric", minute: "2-digit" }) });
      const facts = factsForChecks({
        title: r.title, when, venue: venueDisplayName(r.venue, r.sub_space), city: r.city, category: r.category,
        price: priceText(r.price_min, r.price_max, r.is_free), tags: r.tags ?? [], performers: r.performers ?? [],
        ages: range("ages", r.age_min, r.age_max) ?? range("grades", r.grade_min, r.grade_max), activity: r.activity, registrationRequired: r.registration_required,
      });
      const issues = contentIssues(r.d, facts);
      if (issues) flagged.push({ title: r.title, d: r.d, why: describeIssues(issues), evaluative: issues.evaluative.length > 0, grounding: issues.ungrounded.length > 0 });
    }
    console.log(`${rows.length} descriptions checked: ${flagged.length} flagged (${flagged.filter((f) => f.evaluative).length} evaluative, ${flagged.filter((f) => f.grounding).length} grounding)`);
    const byWhy = new Map<string, number>();
    for (const f of flagged) byWhy.set(f.why, (byWhy.get(f.why) ?? 0) + 1);
    console.log("\nBy reason:");
    for (const [why, n] of [...byWhy].sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${why}`);
    const seen = new Set<string>();
    const examples = flagged.filter((f) => !seen.has(f.why) && seen.add(f.why)).slice(0, Number(args.examples));
    console.log("\nExamples:");
    for (const f of examples) console.log(`- ${f.title}\n    "${f.d}"\n    → ${f.why}`);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
