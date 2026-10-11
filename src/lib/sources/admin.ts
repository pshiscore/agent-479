import { and, desc, eq, gte, sql } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { agentActions, sources } from "@/lib/db/schema";
import type { TestFetchReport } from "./test-fetch";
import type { SourceRow } from "./types";

/**
 * Turning sources on and off. Every change is logged with a reason. The rules
 * (AGENTS.md rule 6):
 * - untested → enabled only through a passing test fetch.
 * - awaiting_permission → never fetched, not even a test. When the owner
 *   records permission it becomes untested, and the normal path applies.
 * - blocked or manual → enabled only by the owner, by hand, with a reason.
 * - opted out (a site owner asked us to stop, via /bot) → disabled as manual
 *   with an "Opt-out request" reason; re-enabled only with a reason that
 *   starts "Permission", i.e. the site owner's written permission.
 */

export const OPT_OUT_PREFIX = "Opt-out request";
export const PERMISSION_PREFIX = "Permission";

export class SourceStateError extends Error {}

/** After this many failed fetches in a row, the admin page flags the source. */
export const NEEDS_ATTENTION_FAILURES = 3;

const MIN_REASON = 10;

function requireReason(reason: string | undefined): string {
  const r = reason?.trim() ?? "";
  if (r.length < MIN_REASON) throw new SourceStateError(`a reason of at least ${MIN_REASON} characters is required`);
  return r;
}

/** The test-fetch gate: only a disabled source that has never been tested. */
export function assertTestFetchAllowed(source: Pick<SourceRow, "slug" | "enabled" | "disabledReason">): void {
  if (source.enabled || source.disabledReason !== "untested") {
    const state = source.enabled ? "enabled" : source.disabledReason;
    throw new SourceStateError(
      `${source.slug}: test fetches are only for untested sources (this one is ${state})`,
    );
  }
}

async function loadBySlug(db: DbExecutor, slug: string): Promise<SourceRow> {
  const [s] = await db.select().from(sources).where(eq(sources.slug, slug));
  if (!s) throw new SourceStateError(`no source ${slug}`);
  return s;
}

async function change(
  db: DbExecutor,
  source: SourceRow,
  set: Partial<Pick<SourceRow, "enabled" | "disabledReason">>,
  log: { actor: string; action: "enable" | "disable" | "update"; reason: string },
): Promise<SourceRow> {
  return db.transaction(async (tx) => {
    const [after] = await tx.update(sources).set(set).where(eq(sources.id, source.id)).returning();
    await recordAction(tx, {
      actor: log.actor,
      action: log.action,
      entityType: "source",
      entityId: source.id,
      before: source,
      after,
      reason: log.reason,
    });
    return after;
  });
}

/** Enables an untested source after its test fetch passed. */
export async function enableAfterTest(db: DbExecutor, slug: string, report: TestFetchReport, actor: string) {
  const source = await loadBySlug(db, slug);
  assertTestFetchAllowed(source);
  if (!report.pass || report.slug !== slug) throw new SourceStateError(`${slug}: not enabling without a passing test fetch`);
  return change(db, source, { enabled: true, disabledReason: null }, {
    actor,
    action: "enable",
    reason:
      `Test fetch passed: ${report.items} events, ${report.upcoming} upcoming, ` +
      `${report.firstDate} to ${report.lastDate}; feeds ${report.feedUrls.join(", ")}.`,
  });
}

/** The owner re-enables a blocked or manually disabled source, with a reason. No test fetch. */
export async function enableManually(db: DbExecutor, slug: string, reason: string, actor: string) {
  const r = requireReason(reason);
  if (!actor.startsWith("human:")) throw new SourceStateError("only a person can re-enable a source by hand");
  const source = await loadBySlug(db, slug);
  if (source.enabled) throw new SourceStateError(`${slug} is already enabled`);
  if (source.disabledReason === "untested") throw new SourceStateError(`${slug} is untested: enable it through a test fetch`);
  if (source.disabledReason === "awaiting_permission") {
    throw new SourceStateError(`${slug} is awaiting permission: record the permission first`);
  }
  if ((await lastDisableReason(db, source.id))?.startsWith(OPT_OUT_PREFIX) && !r.startsWith(PERMISSION_PREFIX)) {
    throw new SourceStateError(`${slug} opted out: re-enable only with the site owner's written permission (a reason starting "${PERMISSION_PREFIX}")`);
  }
  return change(db, source, { enabled: true, disabledReason: null }, {
    actor,
    action: "enable",
    reason: `Re-enabled by hand (was ${source.disabledReason}): ${r}`,
  });
}

async function lastDisableReason(db: DbExecutor, sourceId: string): Promise<string | null> {
  const [a] = await db
    .select({ reason: agentActions.reason })
    .from(agentActions)
    .where(and(eq(agentActions.entityType, "source"), eq(agentActions.entityId, sourceId), eq(agentActions.action, "disable")))
    .orderBy(desc(agentActions.createdAt))
    .limit(1);
  return a?.reason ?? null;
}

/**
 * A site owner asked us to stop (by email, per /bot). The source is turned off
 * by hand, logged as an opt-out. Works whatever state the source is in, so an
 * untested source can't be test fetched and enabled afterwards.
 */
export async function optOut(db: DbExecutor, slug: string, reason: string, actor: string) {
  const r = requireReason(reason);
  if (!actor.startsWith("human:")) throw new SourceStateError("only a person records an opt-out");
  const source = await loadBySlug(db, slug);
  if (!source.enabled && source.disabledReason === "manual" && (await lastDisableReason(db, source.id))?.startsWith(OPT_OUT_PREFIX)) {
    throw new SourceStateError(`${slug} has already opted out`);
  }
  return change(db, source, { enabled: false, disabledReason: "manual" }, { actor, action: "disable", reason: `${OPT_OUT_PREFIX}: ${r}` });
}

/** Pairs to label before a source's dedup goes live (plan section 6, rule 7). */
export const LIVE_DEDUP_MIN_LABELS = 10;

/**
 * Switches a source's dedup between shadow (decisions logged, nothing merges)
 * and live (merges). Going live needs the owner's labels on about 10 pairs
 * involving the source, or on every pair it has if it has fewer. Logged.
 */
export async function setDedupMode(db: DbExecutor, slug: string, mode: "shadow" | "live", reason: string, actor: string) {
  const r = requireReason(reason);
  if (!actor.startsWith("human:")) throw new SourceStateError("only a person changes dedup mode");
  const source = await loadBySlug(db, slug);
  if (source.dedupMode === mode) throw new SourceStateError(`${slug} is already ${mode}`);
  if (mode === "live") {
    const [counts] = (await db.execute(sql`
      select count(*)::int pairs, count(l.id)::int labeled
      from dedup_candidates c
      join event_sources ea on ea.event_id = c.event_a_id and ea.is_primary
      join event_sources eb on eb.event_id = c.event_b_id and eb.is_primary
      left join dedup_labels l on l.candidate_id = c.id
      where ea.source_id = ${source.id} or eb.source_id = ${source.id}`)) as unknown as { pairs: number; labeled: number }[];
    const need = Math.min(LIVE_DEDUP_MIN_LABELS, counts.pairs);
    if (counts.labeled < need) {
      throw new SourceStateError(`${slug}: label at least ${need} of its pairs first (${counts.labeled} labeled of ${counts.pairs})`);
    }
  }
  return db.transaction(async (tx) => {
    const [after] = await tx.update(sources).set({ dedupMode: mode }).where(eq(sources.id, source.id)).returning();
    await recordAction(tx, { actor, action: "update", entityType: "source", entityId: source.id, before: source, after, reason: `Dedup ${mode}: ${r}` });
    return after;
  });
}

/** The owner turns a source off. */
export async function disableManually(db: DbExecutor, slug: string, reason: string, actor: string) {
  const r = requireReason(reason);
  const source = await loadBySlug(db, slug);
  if (!source.enabled) throw new SourceStateError(`${slug} is already disabled (${source.disabledReason})`);
  return change(db, source, { enabled: false, disabledReason: "manual" }, { actor, action: "disable", reason: r });
}

/** Written permission arrived: the source becomes untested, so it can be test fetched. */
export async function recordPermission(db: DbExecutor, slug: string, reason: string, actor: string) {
  const r = requireReason(reason);
  if (!actor.startsWith("human:")) throw new SourceStateError("only a person can record permission");
  const source = await loadBySlug(db, slug);
  if (source.disabledReason !== "awaiting_permission") {
    throw new SourceStateError(`${slug} isn't awaiting permission (${source.enabled ? "enabled" : source.disabledReason})`);
  }
  return change(db, source, { disabledReason: "untested" }, {
    actor,
    action: "update",
    reason: `Permission recorded: ${r}`,
  });
}

/** For the admin page: enabled sources failing repeatedly (flagged, not disabled). */
export async function sourcesNeedingAttention(db: DbExecutor) {
  return db
    .select()
    .from(sources)
    .where(and(eq(sources.enabled, true), gte(sources.consecutiveFailures, NEEDS_ATTENTION_FAILURES)))
    .orderBy(desc(sources.consecutiveFailures));
}

/** For the admin page: sources the pipeline disabled after a block, with the logged reason. */
export async function blockedSources(db: DbExecutor) {
  const blocked = await db.select().from(sources).where(eq(sources.disabledReason, "blocked"));
  // One at a time: a burst of queries larger than the pool can stall Supabase's pooler (src/lib/db/client.ts).
  const out = [];
  for (const source of blocked) {
    const [action] = await db
      .select({ reason: agentActions.reason, at: agentActions.createdAt })
      .from(agentActions)
      .where(and(eq(agentActions.entityId, source.id), eq(agentActions.action, "disable")))
      .orderBy(desc(agentActions.createdAt))
      .limit(1);
    out.push({ source, disabledAt: action?.at ?? null, reason: action?.reason ?? source.lastError });
  }
  return out;
}
