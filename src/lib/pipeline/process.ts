import { and, asc, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { agentActor } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { rawRecords, sources } from "@/lib/db/schema";
import { Deadline } from "@/lib/cron-budget";
import { claimJob } from "@/lib/jobs";
import { loadActiveTaxonomy } from "@/lib/categories";
import { generateStructured, LlmError } from "@/lib/llm";
import { finishRun } from "@/lib/runs";
import { enrichRecord } from "./enrich";
import type { Generate } from "./enrich/types";
import { exclusionReason } from "./exclude";
import { MapError, mapRecord, SkipRecord } from "./map";
import { locationKey } from "./map/location";
import { type LlmVenuePick, llmVenuePick, resolveVenue } from "./venue-resolve";
import { proposeVenues } from "./venue-proposals";
import { checkVagueLocation, vagueRecordsDue } from "./location-detail";
import { detectSeries } from "./series";
import { runDedup } from "./dedup";
import { selectFeature } from "./feature";
import { sourceVisible } from "@/lib/site/visibility";
import { PoliteClient } from "@/lib/sources/http";

/**
 * The process stage (build step 12): map each pending raw record to facts,
 * drop the ones we don't list, and find its venue. Each record ends mapped,
 * needs_venue, skipped, or failed; counts go in runs.stats. Events are written
 * from mapped records by the enrich stage (build step 13), never for
 * needs_venue records.
 */

export type Outcome = "mapped" | "needs_venue" | "skipped" | "failed";

const ACTOR = agentActor("process");
// needs_venue records are re-checked daily, so new venues and links take effect.
const RECHECK_NEEDS_VENUE_MS = 24 * 60 * 60_000;

export async function processRecord(
  db: DbExecutor,
  record: typeof rawRecords.$inferSelect,
  source: typeof sources.$inferSelect,
  opts: { now: Date; llmPick?: LlmVenuePick; runId?: string | null },
): Promise<{ outcome: Outcome; detail: string }> {
  const base = { attempts: record.attempts + 1, processedAt: opts.now };
  const set = (values: Partial<typeof rawRecords.$inferInsert>) =>
    db.update(rawRecords).set({ ...base, ...values }).where(eq(rawRecords.id, record.id));
  try {
    if (!record.payload) throw new MapError("payload was purged");
    const facts = mapRecord(record.payload, source);
    const skip = exclusionReason(facts, opts.now, source.config);
    if (skip) {
      await set({ status: "skipped", skipReason: skip, facts, lastError: null, venueId: null, locationKey: null });
      return { outcome: "skipped", detail: skip };
    }
    // A venue the owner approved for this record (/admin/proposals) stays put.
    const venue =
      record.venueMatchedBy === "owner" && record.venueId
        ? { venueId: record.venueId, subSpace: record.subSpace, matchedBy: "owner" }
        : await resolveVenue(db, facts, source, { llmPick: opts.llmPick, runId: opts.runId });
    if (!venue) {
      await set({ status: "needs_venue", facts, locationKey: locationKey(facts.location), venueId: null, subSpace: null, venueMatchedBy: null, lastError: null, skipReason: null });
      return { outcome: "needs_venue", detail: facts.location.text ?? "no location" };
    }
    await set({ status: "mapped", facts, venueId: venue.venueId, subSpace: venue.subSpace, venueMatchedBy: venue.matchedBy, locationKey: null, lastError: null, skipReason: null });
    return { outcome: "mapped", detail: venue.matchedBy };
  } catch (err) {
    if (err instanceof SkipRecord) {
      await set({ status: "skipped", skipReason: err.reason, lastError: null });
      return { outcome: "skipped", detail: err.reason };
    }
    // Out of budget: leave the record pending and stop the batch.
    if (err instanceof LlmError) throw err;
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
    await set({ status: "failed", lastError: message });
    return { outcome: "failed", detail: message };
  }
}

export async function runProcessJob(
  db: DbExecutor,
  opts: {
    now?: Date;
    batchSize?: number;
    llmPick?: LlmVenuePick | null;
    enrichBatchSize?: number;
    generate?: Generate;
    detailBatchSize?: number;
    dedupLlmLimit?: number;
    http?: PoliteClient;
    deadline?: Deadline;
  } = {},
) {
  const now = opts.now ?? new Date();
  const deadline = opts.deadline ?? new Deadline();
  const claim = await claimJob(db, "process", { now });
  if (!claim) return null;
  const llmPick = opts.llmPick === null ? undefined : (opts.llmPick ?? llmVenuePick);
  const generate = opts.generate ?? (((req) => generateStructured(req, { db })) as Generate);
  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  try {
    const batch = await db
      .select({ record: rawRecords, source: sources })
      .from(rawRecords)
      .innerJoin(sources, eq(sources.id, rawRecords.sourceId))
      .where(
        and(
          isNotNull(rawRecords.payload),
          or(
            eq(rawRecords.status, "pending"),
            and(eq(rawRecords.status, "needs_venue"), lt(rawRecords.processedAt, new Date(now.getTime() - RECHECK_NEEDS_VENUE_MS))),
          ),
        ),
      )
      .orderBy(asc(rawRecords.fetchedAt))
      .limit(opts.batchSize ?? 50);
    let stoppedForBudget = false;
    // Out of time: stop starting new work. Unreached records stay pending (or mapped) for the next run.
    const phasesSkipped: string[] = [];
    const timeLeft = (phase: string) => {
      if (!deadline.passed) return true;
      phasesSkipped.push(phase);
      return false;
    };
    for (const { record, source } of batch) {
      if (!timeLeft("records")) break;
      try {
        const { outcome, detail } = await processRecord(db, record, source, { now, llmPick, runId: claim.id });
        bump(outcome);
        if (outcome === "mapped") bump(`venue_by_${detail}`);
        if (outcome === "skipped") bump(`skip_${detail}`);
      } catch (err) {
        if (err instanceof LlmError) {
          stoppedForBudget = true;
          break;
        }
        throw err;
      }
    }
    // Enrich mapped records into events, soonest first (build step 13).
    const enrichLimit = opts.enrichBatchSize ?? 20;
    if (!stoppedForBudget && enrichLimit > 0) {
      const toEnrich = await db
        .select()
        .from(rawRecords)
        .where(eq(rawRecords.status, "mapped"))
        .orderBy(sql`${rawRecords.facts}->>'startAt'`)
        .limit(enrichLimit);
      if (toEnrich.length) {
        const taxonomy = await loadActiveTaxonomy(db);
        for (const record of toEnrich) {
          if (!timeLeft("enrich")) break;
          try {
            const r = await enrichRecord(db, record, { generate, taxonomy, runId: claim.id });
            bump(r.shadow ? `shadow_${r.shadow}` : r.created ? "events_created" : "events_updated");
            if (r.held) bump("descriptions_held");
          } catch (err) {
            if (err instanceof LlmError) {
              bump(`enrich_llm_${err.code}`);
              stoppedForBudget = err.code === "budget_exceeded";
              if (stoppedForBudget) break;
              continue;
            }
            bump("enrich_failed");
            await db
              .update(rawRecords)
              .set({ lastError: `enrich: ${(err instanceof Error ? err.message : String(err)).slice(0, 1900)}` })
              .where(eq(rawRecords.id, record.id));
          }
        }
      }
    }
    // Series (build step 14): group upcoming events into recurring programs and runs.
    const series = timeLeft("series") ? await detectSeries(db, { now, actor: ACTOR, runId: claim.id }) : null;

    // Dedup (build step 15): shadow mode logs decisions; only live sources merge.
    let dedup: Awaited<ReturnType<typeof runDedup>> | null = null;
    if (!stoppedForBudget && timeLeft("dedup")) {
      try {
        dedup = await runDedup(db, { now, actor: ACTOR, generate, runId: claim.id, llmLimit: opts.dedupLlmLimit ?? 20 });
      } catch (err) {
        if (!(err instanceof LlmError)) throw err;
        stoppedForBudget = err.code === "budget_exceeded";
      }
    }

    // The homepage feature slot (step 18): rules from config, logged when it changes.
    const feature = timeLeft("feature") ? await selectFeature(db, { now, actor: ACTOR, runId: claim.id, publicFilter: (slug) => sourceVisible(slug) }) : { changed: false };

    // Vague locations (a bare city or ZIP, or prose): look on the event's own
    // detail page for a specific place, and propose what's found to the owner.
    const detailLimit = opts.detailBatchSize ?? 10;
    if (!stoppedForBudget && detailLimit > 0) {
      const http = opts.http ?? new PoliteClient();
      const blockedSources = new Set<string>();
      for (const { record, source } of await vagueRecordsDue(db, now, detailLimit)) {
        if (!timeLeft("location detail")) break;
        if (blockedSources.has(source.id)) continue;
        try {
          const r = await checkVagueLocation(db, record, source, { http, generate, llmPick, actor: ACTOR, runId: claim.id, now });
          bump(`detail_${r.outcome}`);
          if (r.outcome === "blocked") blockedSources.add(source.id);
        } catch (err) {
          if (err instanceof LlmError && err.code === "budget_exceeded") {
            stoppedForBudget = true;
            break;
          }
          // Timeouts, 5xx, and bad pages wait for the next weekly check.
          bump("detail_failed");
          await db.update(rawRecords).set({ locationCheckedAt: now }).where(eq(rawRecords.id, record.id));
        }
      }
    }
    const proposals = timeLeft("venue proposals") ? await proposeVenues(db, { actor: ACTOR, runId: claim.id }) : { proposed: 0 };
    const [{ remaining }] = await db
      .select({ remaining: sql<number>`count(*)::int` })
      .from(rawRecords)
      .where(and(eq(rawRecords.status, "pending"), isNotNull(rawRecords.payload)));
    const [{ toEnrichLeft }] = await db
      .select({ toEnrichLeft: sql<number>`count(*)::int` })
      .from(rawRecords)
      .where(eq(rawRecords.status, "mapped"));
    const stoppedForTime = phasesSkipped.length > 0;
    const stats = { batch: batch.length, ...counts, series, dedup, featureChanged: feature.changed, venueProposals: proposals.proposed, remaining, toEnrichLeft, stoppedForBudget, stoppedForTime, phasesSkipped: [...new Set(phasesSkipped)], elapsedMs: deadline.elapsedMs };
    await finishRun(db, claim.id, { status: stoppedForBudget || stoppedForTime ? "partial" : "ok", stats });
    return stats;
  } catch (err) {
    await finishRun(db, claim.id, { status: "failed", error: String(err).slice(0, 2000) });
    throw err;
  }
}

