import { and, desc, eq, gte } from "drizzle-orm";
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
 */

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
  return change(db, source, { enabled: true, disabledReason: null }, {
    actor,
    action: "enable",
    reason: `Re-enabled by hand (was ${source.disabledReason}): ${r}`,
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
  return Promise.all(
    blocked.map(async (source) => {
      const [action] = await db
        .select({ reason: agentActions.reason, at: agentActions.createdAt })
        .from(agentActions)
        .where(and(eq(agentActions.entityId, source.id), eq(agentActions.action, "disable")))
        .orderBy(desc(agentActions.createdAt))
        .limit(1);
      return { source, disabledAt: action?.at ?? null, reason: action?.reason ?? source.lastError };
    }),
  );
}
