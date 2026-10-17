import { sql } from "drizzle-orm";
import { inCoverageArea } from "@/config/coverage";
import type { DbExecutor } from "@/lib/db/client";
import { setPublishState } from "./admin";

/**
 * Automatic demotion (owner, 2026-10-16): a live source goes back to shadow,
 * logged (and listed on the admin overview), when in the last 7 days
 * - its feed failed 3 runs in a row, or
 * - the owner rejected or hid more than 20% of its events (at least 5 events), or
 * - it produced an event at a venue outside the coverage area.
 * Promotion back to live is the owner's.
 */

export const DEMOTION = { failures: 3, rejectShare: 0.2, minEvents: 5, days: 7 } as const;

export interface LiveSourceWeek {
  slug: string;
  consecutiveFailures: number;
  events: number;
  rejectedOrHidden: number;
  outsideCities: string[];
}

/** Pure: why a live source should go back to shadow, or null. */
export function demotionReason(w: LiveSourceWeek): string | null {
  if (w.consecutiveFailures >= DEMOTION.failures) return `its feed failed ${w.consecutiveFailures} runs in a row`;
  if (w.events >= DEMOTION.minEvents && w.rejectedOrHidden / w.events > DEMOTION.rejectShare) {
    return `${w.rejectedOrHidden} of its ${w.events} events this week were rejected or hidden (over ${DEMOTION.rejectShare * 100}%)`;
  }
  const outside = w.outsideCities.filter((c) => !inCoverageArea(c));
  if (outside.length) return `it produced events outside the coverage area (${[...new Set(outside)].join(", ")})`;
  return null;
}

export async function demoteLiveSources(db: DbExecutor, now: Date, actor: string): Promise<{ slug: string; reason: string }[]> {
  const since = new Date(now.getTime() - DEMOTION.days * 86_400_000).toISOString();
  const rows = (await db.execute(sql`
    select s.slug, s.consecutive_failures,
      (select count(*)::int from events e join event_sources es on es.event_id = e.id and es.is_primary
        where es.source_id = s.id and e.first_seen_at >= ${since}::timestamptz) events,
      (select count(*)::int from event_proposals p
        where p.source_id = s.id and p.status = 'rejected' and coalesce(p.reject_kind, 'other') <> 'filtered' and p.decided_at >= ${since}::timestamptz)
      + (select count(*)::int from agent_actions a join event_sources es on es.event_id = a.entity_id and es.is_primary
        where es.source_id = s.id and a.entity_type = 'event' and a.action = 'rollback' and a.actor like 'human:%' and a.created_at >= ${since}::timestamptz) rejected_or_hidden,
      coalesce((select array_agg(distinct v.city) from events e join event_sources es on es.event_id = e.id and es.is_primary join venues v on v.id = e.venue_id
        where es.source_id = s.id and e.first_seen_at >= ${since}::timestamptz), '{}') cities
    from sources s where s.publish_state = 'live' and s.enabled`)) as unknown as { slug: string; consecutive_failures: number; events: number; rejected_or_hidden: number; cities: string[] }[];
  const demoted: { slug: string; reason: string }[] = [];
  // One source at a time (no query bursts; src/lib/db/client.ts).
  for (const r of rows) {
    const reason = demotionReason({ slug: r.slug, consecutiveFailures: r.consecutive_failures, events: r.events, rejectedOrHidden: r.rejected_or_hidden, outsideCities: r.cities });
    if (!reason) continue;
    await setPublishState(db, r.slug, "shadow", `Demoted automatically: ${reason}`, actor);
    demoted.push({ slug: r.slug, reason });
  }
  return demoted;
}
