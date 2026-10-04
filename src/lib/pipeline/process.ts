import { and, asc, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { agentActor } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { rawRecords, sources } from "@/lib/db/schema";
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
    const skip = exclusionReason(facts, opts.now);
    if (skip) {
      await set({ status: "skipped", skipReason: skip, facts, lastError: null, venueId: null, locationKey: null });
      return { outcome: "skipped", detail: skip };
    }
    const venue = await resolveVenue(db, facts, source, { llmPick: opts.llmPick, runId: opts.runId });
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
  opts: { now?: Date; batchSize?: number; llmPick?: LlmVenuePick | null; enrichBatchSize?: number; generate?: Generate } = {},
) {
  const now = opts.now ?? new Date();
  const claim = await claimJob(db, "process", { now });
  if (!claim) return null;
  const llmPick = opts.llmPick === null ? undefined : (opts.llmPick ?? llmVenuePick);
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
    for (const { record, source } of batch) {
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
        const generate = opts.generate ?? (((req) => generateStructured(req, { db })) as Generate);
        for (const record of toEnrich) {
          try {
            const r = await enrichRecord(db, record, { generate, taxonomy, runId: claim.id });
            bump(r.created ? "events_created" : "events_updated");
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
    const proposals = await proposeVenues(db, { actor: ACTOR, runId: claim.id });
    const [{ remaining }] = await db
      .select({ remaining: sql<number>`count(*)::int` })
      .from(rawRecords)
      .where(and(eq(rawRecords.status, "pending"), isNotNull(rawRecords.payload)));
    const [{ toEnrichLeft }] = await db
      .select({ toEnrichLeft: sql<number>`count(*)::int` })
      .from(rawRecords)
      .where(eq(rawRecords.status, "mapped"));
    const stats = { batch: batch.length, ...counts, venueProposals: proposals.proposed, remaining, toEnrichLeft, stoppedForBudget };
    await finishRun(db, claim.id, { status: stoppedForBudget ? "partial" : "ok", stats });
    return stats;
  } catch (err) {
    await finishRun(db, claim.id, { status: "failed", error: String(err).slice(0, 2000) });
    throw err;
  }
}

