import { eq, sql } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import { DEDUP_THRESHOLDS } from "@/config/dedup";
import type { DbExecutor } from "@/lib/db/client";
import { type DedupScores, dedupCandidates, dedupLabels } from "@/lib/db/schema";
import { computeThresholds } from "@/lib/pipeline/dedup/thresholds";

/**
 * The owner labels near-threshold pairs (plan section 6, rule 7; step 17).
 * The queue shows unlabeled pairs nearest a threshold, one per pair of
 * titles, so 18 weekly "Math Olympiads" pairs take one label, not 18.
 * A label freezes both events' facts, so the regression set survives later
 * data changes. Facts only: titles, times, places, sources, links. No source
 * text.
 */

export class DedupReviewError extends Error {}

export interface FrozenFacts {
  eventId: string;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  timeTba: boolean;
  venue: string;
  venueSlug: string;
  subSpace: string | null;
  city: string;
  source: string;
  sourceId: string;
  ticketUrl: string | null;
  sourceUrl: string | null;
}

export interface QueueItem {
  candidateId: string;
  decision: string;
  confidence: number | null;
  scores: DedupScores;
  distance: number;
  sameTitlePairs: number;
  a: FrozenFacts;
  b: FrozenFacts;
}

async function frozen(db: DbExecutor, eventId: string): Promise<FrozenFacts> {
  const [r] = (await db.execute(sql`
    select e.id, e.title, e.start_at, e.end_at, e.all_day, e.time_tba, v.name venue, v.slug venue_slug, e.sub_space, v.city,
      s.slug source, s.id source_id, e.ticket_url, e.primary_source_url
    from events e join venues v on v.id = e.venue_id
    join event_sources es on es.event_id = e.id and es.is_primary join sources s on s.id = es.source_id
    where e.id = ${eventId}`)) as unknown as Record<string, unknown>[];
  if (!r) throw new DedupReviewError("event not found");
  return {
    eventId: String(r.id),
    title: String(r.title),
    startAt: new Date(r.start_at as string).toISOString(),
    endAt: r.end_at ? new Date(r.end_at as string).toISOString() : null,
    allDay: Boolean(r.all_day),
    timeTba: Boolean(r.time_tba),
    venue: String(r.venue),
    venueSlug: String(r.venue_slug),
    subSpace: (r.sub_space as string | null) ?? null,
    city: String(r.city),
    source: String(r.source),
    sourceId: String(r.source_id),
    ticketUrl: (r.ticket_url as string | null) ?? null,
    sourceUrl: (r.primary_source_url as string | null) ?? null,
  };
}

/** Unlabeled pairs nearest a threshold, one per pair of titles. */
export async function reviewQueue(db: DbExecutor, limit = 30): Promise<QueueItem[]> {
  const { tMerge, tLlm } = DEDUP_THRESHOLDS;
  const rows = (await db.execute(sql`
    with c as (
      select c.id, c.event_a_id, c.event_b_id, c.decision, c.confidence, c.scores,
        least(abs((c.scores->>'score')::float - ${tMerge}), abs((c.scores->>'score')::float - ${tLlm})) distance,
        least(a.normalized_title, b.normalized_title) || '|' || greatest(a.normalized_title, b.normalized_title) title_pair
      from dedup_candidates c
      join events a on a.id = c.event_a_id join events b on b.id = c.event_b_id
      where not exists (select 1 from dedup_labels l where l.candidate_id = c.id)
        and a.status = 'scheduled' and b.status = 'scheduled'
    ),
    labeled_pairs as (
      select least(a.normalized_title, b.normalized_title) || '|' || greatest(a.normalized_title, b.normalized_title) title_pair
      from dedup_labels l join dedup_candidates c on c.id = l.candidate_id
      join events a on a.id = c.event_a_id join events b on b.id = c.event_b_id
    ),
    ranked as (
      select c.*, count(*) over (partition by title_pair) same_title_pairs,
        row_number() over (partition by title_pair order by distance, id) rn
      from c where title_pair not in (select title_pair from labeled_pairs)
    )
    select id, event_a_id, event_b_id, decision, confidence, scores, distance, same_title_pairs
    from ranked where rn = 1 order by distance, id limit ${limit}`)) as unknown as {
    id: string; event_a_id: string; event_b_id: string; decision: string; confidence: number | null; scores: DedupScores; distance: number; same_title_pairs: number;
  }[];
  return Promise.all(
    rows.map(async (r) => ({
      candidateId: r.id,
      decision: r.decision,
      confidence: r.confidence === null ? null : Number(r.confidence),
      scores: r.scores,
      distance: Number(r.distance),
      sameTitlePairs: Number(r.same_title_pairs),
      a: await frozen(db, r.event_a_id),
      b: await frozen(db, r.event_b_id),
    })),
  );
}

export async function labelPair(db: DbExecutor, candidateId: string, label: "same" | "different", opts: { actor: string; note?: string }) {
  if (!opts.actor.startsWith("human:")) throw new DedupReviewError("only a person labels pairs");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(dedupCandidates).where(eq(dedupCandidates.id, candidateId));
    if (!c) throw new DedupReviewError("no such pair");
    const [existing] = await tx.select({ id: dedupLabels.id }).from(dedupLabels).where(eq(dedupLabels.candidateId, candidateId));
    if (existing) throw new DedupReviewError("this pair is already labeled");
    const factsA = await frozen(tx, c.eventAId);
    const factsB = await frozen(tx, c.eventBId);
    const [row] = await tx
      .insert(dedupLabels)
      .values({
        candidateId,
        factsA,
        factsB,
        label,
        sourceIds: [...new Set([factsA.sourceId, factsB.sourceId])],
        labeledBy: opts.actor,
        note: opts.note?.trim() || null,
      })
      .returning();
    await recordAction(tx, {
      actor: opts.actor,
      action: "insert",
      entityType: "dedup_label",
      entityId: row.id,
      after: row,
      reason: `Labeled "${factsA.title}" / "${factsB.title}" as ${label}${opts.note?.trim() ? `: ${opts.note.trim()}` : ""}`,
    });
    return row;
  });
}

export async function labeledPairs(db: DbExecutor) {
  return db
    .select({ label: dedupLabels.label, factsA: dedupLabels.factsA, factsB: dedupLabels.factsB, labeledAt: dedupLabels.labeledAt, note: dedupLabels.note, scores: dedupCandidates.scores, decision: dedupCandidates.decision })
    .from(dedupLabels)
    .innerJoin(dedupCandidates, eq(dedupCandidates.id, dedupLabels.candidateId))
    .orderBy(dedupLabels.labeledAt);
}

/** Thresholds suggested by the labels so far (computeThresholds), against the configured ones. */
export async function suggestedThresholds(db: DbExecutor) {
  const labels = await labeledPairs(db);
  return computeThresholds(
    labels.map((l) => ({
      label: l.label,
      score: l.scores.score,
      startDiffMinutes: l.scores.startDiffMinutes,
      subSpaceDiffers: l.scores.subSpaceDiffers,
      ticketmasterIdMatch: l.scores.ticketmasterIdMatch,
    })),
    DEDUP_THRESHOLDS,
  );
}
