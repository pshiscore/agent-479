import { sql } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { type DedupScores, dedupCandidates, events } from "@/lib/db/schema";
import type { Generate } from "../enrich/types";
import { chooseSurvivor, mergeEvents } from "./merge";
import { decideFromLlm, preDecide, scorePair } from "./score";
import { tiebreak } from "./tiebreak";

/**
 * Duplicate detection over upcoming events (build step 15, plan section 6).
 * 1. Blocking, in SQL: scheduled pairs at the same venue (or sharing a parent
 *    venue), starting within 3 hours, or overlapping days when either is
 *    all-day. Pairs already decided aren't looked at again.
 * 2. Score and decide (score.ts); the LLM tiebreaks the middle band, at most
 *    `llmLimit` calls a run (the rest wait for the next run).
 * 3. Record the decision in dedup_candidates, logged. Two occurrences of the
 *    same detected series at different times are distinct without a model
 *    call: series detection already says they're separate occurrences.
 * 4. Merge only when both events' primary sources are in dedup_mode live. Every
 *    source starts in shadow, so today nothing merges.
 */

const BLOCK_HOURS = 3;

interface PairRow {
  aId: string;
  bId: string;
  aTitle: string;
  bTitle: string;
  aStart: Date;
  bStart: Date;
  aEnd: Date | null;
  bEnd: Date | null;
  aAllDay: boolean;
  bAllDay: boolean;
  aTba: boolean;
  bTba: boolean;
  aTicket: string | null;
  bTicket: string | null;
  aUrl: string | null;
  bUrl: string | null;
  aSeries: string | null;
  bSeries: string | null;
  aVenue: string;
  bVenue: string;
  aSource: string;
  bSource: string;
  aPerformers: string[] | null;
  bPerformers: string[] | null;
  aRoom: string | null;
  bRoom: string | null;
  live: boolean;
}

export async function candidatePairs(db: DbExecutor, now: Date, sourceId?: string): Promise<PairRow[]> {
  const since = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const rows = await db.execute(sql`
    with ev as (
      select e.id, e.title, e.start_at, e.end_at, e.all_day, e.time_tba, e.ticket_url, e.primary_source_url, e.series_id,
             e.venue_id, v.parent_venue_id, e.sub_space, coalesce(e.sub_space || ', ', '') || v.name as venue,
             s.id as source_id, s.name as source, s.dedup_mode,
             r.facts->'performers' as performers
      from events e
      join venues v on v.id = e.venue_id
      join event_sources es on es.event_id = e.id and es.is_primary
      join sources s on s.id = es.source_id
      left join raw_records r on r.id = es.raw_record_id
      where e.status = 'scheduled' and e.start_at >= ${since}::timestamptz
    )
    select a.id "aId", b.id "bId", a.title "aTitle", b.title "bTitle", a.start_at "aStart", b.start_at "bStart",
           a.end_at "aEnd", b.end_at "bEnd", a.all_day "aAllDay", b.all_day "bAllDay", a.time_tba "aTba", b.time_tba "bTba",
           a.ticket_url "aTicket", b.ticket_url "bTicket", a.primary_source_url "aUrl", b.primary_source_url "bUrl",
           a.series_id "aSeries", b.series_id "bSeries", a.venue "aVenue", b.venue "bVenue", a.source "aSource", b.source "bSource",
           a.performers "aPerformers", b.performers "bPerformers", a.sub_space "aRoom", b.sub_space "bRoom",
           (a.dedup_mode = 'live' and b.dedup_mode = 'live') as live
    from ev a
    join ev b on a.id < b.id
    where (a.venue_id = b.venue_id or a.parent_venue_id = b.venue_id or b.parent_venue_id = a.venue_id
           or (a.parent_venue_id is not null and a.parent_venue_id = b.parent_venue_id))
      and (abs(extract(epoch from a.start_at - b.start_at)) <= ${BLOCK_HOURS * 3600}
           or ((a.all_day or b.all_day)
               and a.start_at < coalesce(b.end_at, b.start_at + interval '1 day')
               and b.start_at < coalesce(a.end_at, a.start_at + interval '1 day')))
      and not exists (select 1 from dedup_candidates c where c.event_a_id = a.id and c.event_b_id = b.id)
      ${sourceId ? sql`and (a.source_id = ${sourceId} or b.source_id = ${sourceId})` : sql``}
    order by least(a.start_at, b.start_at)`);
  return (rows as unknown as PairRow[]).map((r) => ({ ...r, aStart: new Date(r.aStart), bStart: new Date(r.bStart), aEnd: r.aEnd && new Date(r.aEnd), bEnd: r.bEnd && new Date(r.bEnd) }));
}

export async function runDedup(
  db: DbExecutor,
  opts: { now: Date; actor: string; generate: Generate; runId?: string | null; llmLimit?: number; sourceId?: string },
) {
  const job = opts.actor.replace(/^agent:/, "");
  const stats = { pairs: 0, auto_merge: 0, llm_same: 0, uncertain: 0, distinct: 0, series_siblings: 0, llmCalls: 0, deferred: 0, merged: 0 };
  let llmLeft = opts.llmLimit ?? 20;

  for (const p of await candidatePairs(db, opts.now, opts.sourceId)) {
    const scores: DedupScores = {
      ...scorePair(
        { title: p.aTitle, startAt: p.aStart, ticketUrl: p.aTicket, sourceUrl: p.aUrl, subSpace: p.aRoom },
        { title: p.bTitle, startAt: p.bStart, ticketUrl: p.bTicket, sourceUrl: p.bUrl, subSpace: p.bRoom },
      ),
      llm: null,
    };
    let decision: (typeof dedupCandidates.$inferInsert)["decision"];
    let confidence: number | null = null;
    let llmCallId: string | null = null;
    let model: string | null = null;
    let why: string;

    const pre = preDecide(scores);
    if (p.aSeries && p.aSeries === p.bSeries && scores.startDiffMinutes > 0 && !scores.ticketmasterIdMatch) {
      decision = "distinct";
      why = "two occurrences of the same series at different times";
      stats.series_siblings++;
    } else if (pre === "llm") {
      if (llmLeft <= 0) {
        stats.deferred++;
        continue;
      }
      llmLeft--;
      stats.llmCalls++;
      const side = (s: "a" | "b") => ({
        title: s === "a" ? p.aTitle : p.bTitle,
        startAt: s === "a" ? p.aStart : p.bStart,
        endAt: s === "a" ? p.aEnd : p.bEnd,
        allDay: s === "a" ? p.aAllDay : p.bAllDay,
        timeTba: s === "a" ? p.aTba : p.bTba,
        venue: s === "a" ? p.aVenue : p.bVenue,
        source: s === "a" ? p.aSource : p.bSource,
        performers: (s === "a" ? p.aPerformers : p.bPerformers) ?? [],
      });
      const r = await tiebreak(opts.generate, side("a"), side("b"), opts.runId);
      scores.llm = r.data;
      decision = decideFromLlm(r.data);
      confidence = r.data.confidence;
      llmCallId = r.callId;
      model = r.model;
      why = `tiebreak: ${r.data.same ? "same" : "different"} (confidence ${r.data.confidence})`;
    } else {
      decision = pre;
      why = pre === "auto_merge" ? (scores.ticketmasterIdMatch ? "same Ticketmaster event ID" : `title ${scores.score}, ${scores.startDiffMinutes} min apart`) : `title ${scores.score} below T_llm`;
    }
    stats.pairs++;
    stats[decision]++;

    const mode = p.live ? "live" : "shadow";
    const [cand] = await db
      .insert(dedupCandidates)
      .values({ eventAId: p.aId, eventBId: p.bId, scores, decision, mode, confidence, llmCallId, runId: opts.runId ?? null })
      .returning();
    await recordAction(db, {
      runId: opts.runId,
      actor: opts.actor,
      job,
      action: "insert",
      entityType: "dedup_candidate",
      entityId: cand.id,
      after: cand,
      reason: `${decision} (${mode}): "${p.aTitle}" / "${p.bTitle}": ${why}`,
      model,
      llmCallId,
      confidence,
    });

    if (mode === "live" && (decision === "auto_merge" || decision === "llm_same")) {
      const rows = await db.select().from(events).where(sql`${events.id} in (${p.aId}, ${p.bId})`);
      const { survivor, loser } = await chooseSurvivor(db, rows[0], rows[1]);
      await mergeEvents(db, { survivorId: survivor.id, loserId: loser.id, candidateId: cand.id, actor: opts.actor, runId: opts.runId, reason: `Duplicate (${decision}): ${why}`, now: opts.now });
      stats.merged++;
    }
  }
  return stats;
}
