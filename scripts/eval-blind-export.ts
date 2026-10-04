/**
 * Exports about 40 events for the owner to label blind (no categories or tags).
 *   tests/fixtures/eval/blind.csv                 committed: facts only
 *   tests/fixtures/eval/blind-excerpts.local.csv  gitignored: the source's own
 *       description excerpt, to read while labeling (source text is never committed)
 * Our generated descriptions are left out on purpose: they're written after
 * classification and would hint at the model's category.
 *
 * Usage: npm run eval:blind-export
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { formatInChicago } from "@/lib/time";
import { venueDisplayName } from "@/lib/venues/display";

type Row = {
  id: string; title: string; normalized_title: string; venue_id: string; source: string; venue: string; sub: string | null; start: string; tba: boolean; all_day: boolean;
  is_free: boolean | null; price_min: number | null; price_max: number | null; age_min: number | null; age_max: number | null;
  grade_min: number | null; grade_max: number | null; reg: boolean | null; category: string; series_size: number; adults: boolean; excerpt: string | null;
};

const csv = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

async function main() {
  const db = getDb();
  const rows = await db.execute<Row>(sql`
    select e.id, e.title, e.normalized_title, e.venue_id, s.slug source, v.name venue, e.sub_space sub, e.start_at start, e.time_tba tba, e.all_day,
      e.is_free, e.price_min, e.price_max, e.age_min, e.age_max, e.grade_min, e.grade_max, e.registration_required reg, c.slug category,
      (select count(*)::int from events e2 where e2.normalized_title = e.normalized_title and e2.venue_id = e.venue_id) series_size,
      exists (select 1 from event_tags et join tags t on t.id = et.tag_id where et.event_id = e.id and t.slug = '21-plus') adults,
      left(r.description_text, 400) excerpt
    from events e join event_sources es on es.event_id = e.id and es.is_primary join sources s on s.id = es.source_id
    join venues v on v.id = e.venue_id join categories c on c.id = e.category_id left join raw_records r on r.id = es.raw_record_id
    where e.status = 'scheduled' order by md5(e.id::text)`);

  // Coverage: 2+ per category, every source, and the edge cases; then fill to about 40.
  // One occurrence per series: a second ESL class teaches the eval nothing.
  const picked = new Map<string, Row>();
  const seriesKey = (r: Row) => `${r.normalized_title}|${r.venue_id}`;
  const series = new Set<string>();
  const take = (pred: (r: Row) => boolean, n: number, label?: string) => {
    const want = n;
    for (const r of rows) {
      if (n <= 0) break;
      if (!picked.has(r.id) && !series.has(seriesKey(r)) && pred(r)) {
        picked.set(r.id, r);
        series.add(seriesKey(r));
        n--;
      }
    }
    if (label && n === want) console.warn(`No events available for coverage bucket: ${label}`);
  };
  for (const cat of new Set(rows.map((r) => r.category))) take((r) => r.category === cat, 2);
  for (const src of new Set(rows.map((r) => r.source))) take((r) => r.source === src, 2);
  take((r) => r.adults, 2, "21+");
  take((r) => r.series_size >= 3, 3, "recurring series");
  take((r) => r.price_min !== null && r.price_min > 0, 2, "paid");
  take((r) => r.is_free === true, 2, "free");
  take((r) => r.source === "ticketmaster", 4);
  take(() => true, Math.max(0, 40 - picked.size));

  const list = [...picked.values()].sort((a, b) => a.start.localeCompare(b.start));
  const when = (r: Row) =>
    formatInChicago(new Date(r.start), { weekday: "short", month: "short", day: "numeric", ...(r.tba || r.all_day ? {} : { hour: "numeric", minute: "2-digit" }) }) +
    (r.tba ? " (time TBA)" : r.all_day ? " (all day)" : "");
  const price = (r: Row) =>
    r.price_min !== null ? `$${r.price_min}${r.price_max && r.price_max > r.price_min ? `–$${r.price_max}` : ""}` : r.is_free ? "Free (stated)" : "";
  const ages = (r: Row) =>
    [r.age_min !== null || r.age_max !== null ? `ages ${r.age_min ?? ""}–${r.age_max ?? ""}` : null, r.grade_min !== null || r.grade_max !== null ? `grades ${r.grade_min ?? ""}–${r.grade_max ?? ""}` : null]
      .filter(Boolean)
      .join("; ");

  const header = ["id", "title", "source", "venue", "when", "price", "ages", "registration_required", "series_occurrences", "category", "tags"];
  const lines = [header.join(","), ...list.map((r) => [r.id, r.title, r.source, venueDisplayName(r.venue, r.sub), when(r), price(r), ages(r), r.reg ?? "", r.series_size, "", ""].map(csv).join(","))];
  await writeFile("tests/fixtures/eval/blind.csv", `${lines.join("\n")}\n`);
  const ex = ["id,title,source_excerpt", ...list.map((r) => [r.id, r.title, r.excerpt ?? ""].map(csv).join(","))];
  await writeFile("tests/fixtures/eval/blind-excerpts.local.csv", `${ex.join("\n")}\n`);

  // Coverage summary (by the model's current categories, which aren't in the file).
  const count = (k: keyof Row) => Object.entries(list.reduce<Record<string, number>>((m, r) => ((m[String(r[k])] = (m[String(r[k])] ?? 0) + 1), m), {}));
  console.log(`${list.length} events. By source:`, count("source"));
  console.log("By model category (not exported):", count("category"));
  console.log("21+:", list.filter((r) => r.adults).length, "| recurring:", list.filter((r) => r.series_size >= 3).length, "| paid:", list.filter((r) => (r.price_min ?? 0) > 0).length, "| free:", list.filter((r) => r.is_free).length);
  await db.$client.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
