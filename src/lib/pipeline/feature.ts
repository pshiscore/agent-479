import { desc, sql } from "drizzle-orm";
import { FEATURE_RULES } from "@/config/front-page";
import { recordAction } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { homepageFeatures } from "@/lib/db/schema";

/**
 * The homepage feature slot (docs/product/front-page.md, B1): one upcoming
 * event chosen by config rules (src/config/front-page.ts), never judgment.
 * Run by the process job; a new row (logged) only when the winner changes.
 */

export interface FeatureCandidate {
  id: string;
  startAt: Date;
  firstSeenAt: Date;
  venueSlug: string;
  categorySlug: string;
  inRecurringSeries: boolean;
}

export interface ScoredCandidate {
  id: string;
  score: number;
  rules: { newlyAnnounced: boolean; largeVenue: boolean };
  startAt: Date;
}

const DAY = 86_400_000;

/** Pure: the winner by rule score, then the soonest start. Null when nothing qualifies. */
export function pickFeature(candidates: readonly FeatureCandidate[], now: Date, rules = FEATURE_RULES): ScoredCandidate | null {
  const horizon = now.getTime() + rules.horizonDays * DAY;
  const large = new Set<string>(rules.largeVenue.venues);
  const excluded = new Set<string>(rules.largeVenue.excludeCategories);
  const scored = candidates
    .filter((c) => !c.inRecurringSeries && c.startAt.getTime() > now.getTime() && c.startAt.getTime() <= horizon)
    .map((c) => {
      const r = {
        newlyAnnounced: now.getTime() - c.firstSeenAt.getTime() <= rules.newlyAnnounced.days * DAY,
        largeVenue: large.has(c.venueSlug) && !excluded.has(c.categorySlug),
      };
      return { id: c.id, startAt: c.startAt, rules: r, score: (r.newlyAnnounced ? rules.newlyAnnounced.weight : 0) + (r.largeVenue ? rules.largeVenue.weight : 0) };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.startAt.getTime() - b.startAt.getTime() || a.id.localeCompare(b.id));
  return scored[0] ?? null;
}

export async function selectFeature(db: DbExecutor, opts: { now: Date; actor: string; runId?: string | null; publicFilter?: (sourceSlug: string) => boolean }) {
  const rows = (await db.execute(sql`
    select e.id, e.start_at, e.first_seen_at, v.slug venue_slug, c.slug category_slug, s.slug source_slug,
      coalesce(es2.kind = 'recurring' and es2.active, false) in_series
    from events e
    join venues v on v.id = e.venue_id
    join categories c on c.id = e.category_id
    join event_sources es on es.event_id = e.id and es.is_primary
    join sources s on s.id = es.source_id
    left join event_series es2 on es2.id = e.series_id
    where e.status = 'scheduled' and e.start_at > ${opts.now.toISOString()}::timestamptz`)) as unknown as {
    id: string; start_at: string; first_seen_at: string; venue_slug: string; category_slug: string; source_slug: string; in_series: boolean;
  }[];
  const winner = pickFeature(
    rows
      .filter((r) => !opts.publicFilter || opts.publicFilter(r.source_slug))
      .map((r) => ({ id: r.id, startAt: new Date(r.start_at), firstSeenAt: new Date(r.first_seen_at), venueSlug: r.venue_slug, categorySlug: r.category_slug, inRecurringSeries: r.in_series })),
    opts.now,
  );
  if (!winner) return { changed: false, eventId: null };
  const [current] = await db.select().from(homepageFeatures).orderBy(desc(homepageFeatures.chosenAt)).limit(1);
  if (current?.eventId === winner.id) return { changed: false, eventId: winner.id };
  const [row] = await db.insert(homepageFeatures).values({ eventId: winner.id, rules: winner.rules, score: winner.score, runId: opts.runId ?? null }).returning();
  const met = Object.entries(winner.rules).filter(([, v]) => v).map(([k]) => k).join(", ");
  await recordAction(db, {
    runId: opts.runId,
    actor: opts.actor,
    job: opts.actor.replace(/^agent:/, ""),
    action: "insert",
    entityType: "homepage_feature",
    entityId: row.id,
    after: row,
    reason: `Feature: event ${winner.id} (score ${winner.score}; rules met: ${met})`,
  });
  return { changed: true, eventId: winner.id };
}

/** The current feature's event id, if any. */
export async function currentFeatureEventId(db: DbExecutor): Promise<string | null> {
  const [row] = await db.select({ eventId: homepageFeatures.eventId }).from(homepageFeatures).orderBy(desc(homepageFeatures.chosenAt)).limit(1);
  return row?.eventId ?? null;
}

