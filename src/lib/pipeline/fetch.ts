import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { agentActor, recordAction } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { rawRecords, sources } from "@/lib/db/schema";
import { FetchBlockedError, FetchNotPermittedError } from "@/lib/http/fetch";
import { claimJob } from "@/lib/jobs";
import { hideRemovedShadowEvents } from "@/lib/review/shadow";
import { finishRun, withRun } from "@/lib/runs";
import { PoliteClient } from "@/lib/sources/http";
import { fetcherFor } from "@/lib/sources/registry";
import { type FetchedItem, type FetchResult, SourceConfigError, type SourceRow } from "@/lib/sources/types";
import { canonicalJson } from "@/lib/venues/seed-file";
import { mapRecord } from "./map";

/**
 * The fetch stage: read enabled sources and write raw_records, nothing else
 * (plan section 5, rule 1). The enabled guard lives here, right before each
 * fetch, not in the dispatcher. A block or refusal disables the source with a
 * logged action, so the next cron run can't retry it: a block means stop.
 */

export class SourceDisabledError extends Error {}

const ACTOR = agentActor("fetch");

export interface SourceFetchOutcome {
  slug: string;
  ok: boolean;
  disabled?: boolean;
  error?: string;
  stats?: Record<string, unknown>;
}

// Covers the description too, so an edited description is reprocessed.
const hashItem = (item: FetchedItem) =>
  createHash("sha256")
    .update(canonicalJson({ payload: item.payload, description: item.descriptionText }))
    .digest("hex");

/** Enabled sources whose interval has passed since their last fetch. */
export async function dueSources(db: DbExecutor, now: Date): Promise<SourceRow[]> {
  return db
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.enabled, true),
        // Shadow sources fetch on the normal schedule; paused and proposed ones don't.
        inArray(sources.publishState, ["shadow", "live"]),
        or(
          isNull(sources.lastFetchedAt),
          lte(sources.lastFetchedAt, sql`${now.toISOString()}::timestamptz - make_interval(mins => ${sources.fetchIntervalMinutes})`),
        ),
      ),
    )
    .orderBy(sources.lastFetchedAt);
}

/**
 * Upserts a fetch's items: new ones are inserted as pending; changed ones get
 * the new payload and go back to pending; unchanged ones just record that they
 * were seen. Returns counts for runs.stats.
 */
export async function storeItems(db: DbExecutor, source: SourceRow, runId: string, items: FetchedItem[], now: Date) {
  const stats = { inserted: 0, changed: 0, unchanged: 0 };
  if (items.length === 0) return stats;
  await db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: rawRecords.id,
        externalId: rawRecords.externalId,
        contentHash: rawRecords.contentHash,
        purged: sql<boolean>`${rawRecords.payload} is null`,
      })
      .from(rawRecords)
      .where(and(eq(rawRecords.sourceId, source.id), inArray(rawRecords.externalId, items.map((i) => i.externalId))));
    const byExternal = new Map(existing.map((r) => [r.externalId, r]));
    const unchangedIds: string[] = [];
    const inserts: (typeof rawRecords.$inferInsert)[] = [];

    for (const item of items) {
      const contentHash = hashItem(item);
      const prior = byExternal.get(item.externalId);
      if (!prior) {
        inserts.push({
          sourceId: source.id,
          runId,
          externalId: item.externalId,
          sourceUrl: item.sourceUrl,
          contentHash,
          payload: item.payload,
          descriptionText: item.descriptionText,
          descriptionPurgeAfter: item.descriptionPurgeAfter,
          fetchedAt: now,
        });
      } else if (prior.contentHash === contentHash && !prior.purged) {
        unchangedIds.push(prior.id);
      } else {
        await tx
          .update(rawRecords)
          .set({
            runId,
            sourceUrl: item.sourceUrl,
            contentHash,
            payload: item.payload,
            descriptionText: item.descriptionText,
            descriptionPurgeAfter: item.descriptionPurgeAfter,
            fetchedAt: now,
            status: "pending",
            skipReason: null,
            attempts: 0,
            lastError: null,
          })
          .where(eq(rawRecords.id, prior.id));
        stats.changed++;
      }
    }
    for (let i = 0; i < inserts.length; i += 500) {
      await tx.insert(rawRecords).values(inserts.slice(i, i + 500));
    }
    stats.inserted = inserts.length;
    for (let i = 0; i < unchangedIds.length; i += 1000) {
      await tx.update(rawRecords).set({ fetchedAt: now }).where(inArray(rawRecords.id, unchangedIds.slice(i, i + 1000)));
    }
    stats.unchanged = unchangedIds.length;
  });
  return stats;
}

/** Turns a source off after a block or refusal, logged so the owner sees why. */
export async function disableForBlock(
  db: DbExecutor,
  sourceId: string,
  runId: string | null,
  err: Error,
  now: Date,
  by: { actor: string; job: string } = { actor: ACTOR, job: "fetch" },
) {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(sources).where(eq(sources.id, sourceId));
    if (!before?.enabled) return;
    const [after] = await tx
      .update(sources)
      .set({
        enabled: false,
        disabledReason: "blocked",
        lastFetchedAt: now,
        consecutiveFailures: before.consecutiveFailures + 1,
        lastError: err.message.slice(0, 2000),
      })
      .where(eq(sources.id, sourceId))
      .returning();
    await recordAction(tx, {
      runId,
      actor: by.actor,
      job: by.job,
      action: "disable",
      entityType: "source",
      entityId: sourceId,
      before,
      after,
      reason: `${err.message} A block means stop: re-enabling is manual only, with the owner's reason.`,
    });
  });
}

/**
 * Fetches one source if, and only if, it's enabled right now. Never throws
 * for a fetch failure: the outcome says what happened, and the source row
 * records it.
 */
export async function fetchSource(
  db: DbExecutor,
  sourceId: string,
  opts: { http?: PoliteClient; now?: Date } = {},
): Promise<SourceFetchOutcome> {
  const now = opts.now ?? new Date();
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
  if (!source) throw new Error(`no source ${sourceId}`);
  // The enabled guard: checked here, right before fetching, whatever the caller did.
  if (!source.enabled) throw new SourceDisabledError(`${source.slug} is disabled; not fetching`);
  const fetcher = fetcherFor(source.fetcher);
  const http = opts.http ?? new PoliteClient();
  let runId: string | null = null;

  try {
    const stats = await withRun(
      db,
      "fetch",
      async (run) => {
        runId = run.id;
        if (!fetcher) throw new SourceConfigError(`${source.slug}: no fetcher named ${JSON.stringify(source.fetcher)}`);
        const result: FetchResult = await fetcher.fetch(source, http);
        const stored = await storeItems(db, source, run.id, result.items, now);
        // Shadow sources: approved events the feed no longer lists are hidden (owner, 2026-10-17).
        const removedHidden = source.publishState === "shadow" ? await hideRemovedShadowEvents(db, source, feedCoverage(result.items, source), { actor: agentActor("fetch"), runId: run.id, now }) : 0;
        return { items: result.items.length, ...result.stats, ...stored, removedHidden, feedUrls: result.feedUrls };
      },
      { sourceId: source.id },
    );
    await db
      .update(sources)
      .set({ lastFetchedAt: now, lastSuccessAt: now, consecutiveFailures: 0, lastError: null, robotsCheckedAt: now })
      .where(eq(sources.id, source.id));
    return { slug: source.slug, ok: true, stats };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    if (e instanceof FetchBlockedError || e instanceof FetchNotPermittedError) {
      await disableForBlock(db, source.id, runId, e, now);
      return { slug: source.slug, ok: false, disabled: true, error: e.message };
    }
    // Ordinary failures (timeouts, 5xx, bad data) wait out the normal interval before the next try.
    await db
      .update(sources)
      .set({
        lastFetchedAt: now,
        consecutiveFailures: sql`${sources.consecutiveFailures} + 1`,
        lastError: e.message.slice(0, 2000),
      })
      .where(eq(sources.id, source.id));
    return { slug: source.slug, ok: false, error: e.message };
  }
}

/**
 * The /api/cron/fetch job: claims the job lease, then fetches each due source
 * in turn until the time budget runs out. Returns null if another instance
 * holds the lease.
 */
export async function runFetchJob(
  db: DbExecutor,
  opts: { now?: Date; http?: PoliteClient; budgetMs?: number } = {},
): Promise<{ outcomes: SourceFetchOutcome[]; skipped: number } | null> {
  const now = opts.now ?? new Date();
  const claim = await claimJob(db, "fetch", { now });
  if (!claim) return null;
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 240_000;
  const http = opts.http ?? new PoliteClient();
  const outcomes: SourceFetchOutcome[] = [];
  let skipped = 0;
  try {
    const due = await dueSources(db, now);
    for (const source of due) {
      if (Date.now() - started > budgetMs) {
        skipped++;
        continue;
      }
      outcomes.push(await fetchSource(db, source.id, { http, now }));
    }
    const failed = outcomes.filter((o) => !o.ok).length;
    await finishRun(db, claim.id, {
      status: failed > 0 ? "partial" : "ok",
      stats: { due: due.length, fetched: outcomes.length, failed, skipped, outcomes },
    });
    return { outcomes, skipped };
  } catch (err) {
    await finishRun(db, claim.id, { status: "failed", error: String(err).slice(0, 2000) });
    throw err;
  }
}

/** The external ids a fetch returned, and the latest start among them (the feed's current reach). */
export function feedCoverage(items: readonly { externalId: string; payload: Record<string, unknown> }[], source: Pick<SourceRow, "baseUrl" | "config">) {
  let lastStart: Date | null = null;
  for (const item of items) {
    try {
      const start = new Date(mapRecord(item.payload, source).startAt);
      if (!lastStart || start > lastStart) lastStart = start;
    } catch {
      // Unmappable items say nothing about the feed's reach.
    }
  }
  return { externalIds: items.map((i) => i.externalId), lastStart };
}
