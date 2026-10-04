import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { COMMUNITY_SLUG } from "@/lib/categories";
import type { DbExecutor } from "@/lib/db/client";
import { agentActions, categories, dedupCandidates, events, llmCalls, runs, sources } from "@/lib/db/schema";
import { themeOf } from "@/lib/pipeline/category-themes";
import { needsVenueSummary } from "@/lib/pipeline/maintenance";
import { blockedSources, NEEDS_ATTENTION_FAILURES } from "@/lib/sources/admin";

/** Read-only queries behind /admin. Admin pages are internal (behind the admin login). */

export const COMMUNITY_WARN_SHARE = 0.15;
const DAY = 86_400_000;

/** Plan section 5, rule 6: Community's share of events classified in the last 7 days, and its top hint themes. */
export async function communityStats(db: DbExecutor, now: Date) {
  const [community] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, COMMUNITY_SLUG));
  const rows = await db.execute<{ category_id: string | null; hint: string | null }>(sql`
    select distinct on (entity_id) after->>'categoryId' category_id, after->'_meta'->>'closestMissingCategory' hint
    from agent_actions
    where entity_type = 'event' and action in ('insert', 'update') and created_at >= ${new Date(now.getTime() - 7 * DAY).toISOString()}::timestamptz
      and after ? 'categoryId'
    order by entity_id, created_at desc`);
  const list = rows as unknown as { category_id: string | null; hint: string | null }[];
  const inCommunity = list.filter((r) => r.category_id === community?.id);
  const themes = new Map<string, number>();
  for (const r of inCommunity) if (r.hint) themes.set(themeOf(r.hint), (themes.get(themeOf(r.hint)) ?? 0) + 1);
  const share = list.length ? inCommunity.length / list.length : 0;
  return {
    classified: list.length,
    community: inCommunity.length,
    share,
    warn: share > COMMUNITY_WARN_SHARE,
    topThemes: [...themes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
  };
}

export async function dashboard(db: DbExecutor, now: Date) {
  const [upcoming] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.status, "scheduled"), gte(events.startAt, now)));
  const pending = await db
    .select({ action: agentActions.action, n: sql<number>`count(*)::int` })
    .from(agentActions)
    .where(eq(agentActions.approvalStatus, "pending"))
    .groupBy(agentActions.action);
  const dedup = await db
    .select({ decision: dedupCandidates.decision, mode: dedupCandidates.mode, n: sql<number>`count(*)::int` })
    .from(dedupCandidates)
    .groupBy(dedupCandidates.decision, dedupCandidates.mode);
  const llm = await db
    .select({
      today: sql<number>`coalesce(sum(${llmCalls.costUsd}) filter (where ${llmCalls.createdAt} >= date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago'), 0)::float`,
      week: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)::float`,
    })
    .from(llmCalls)
    .where(gte(llmCalls.createdAt, new Date(now.getTime() - 7 * DAY)));
  return {
    upcoming: upcoming.n,
    needsVenue: await needsVenueSummary(db),
    sources: await db.select().from(sources).orderBy(sources.slug),
    attentionAt: NEEDS_ATTENTION_FAILURES,
    blocked: await blockedSources(db),
    pending,
    dedup,
    llm: llm[0],
    community: await communityStats(db, now),
    runs: await db.select().from(runs).orderBy(desc(runs.startedAt)).limit(12),
  };
}

export const LOG_PAGE_SIZE = 50;

export async function agentLog(db: DbExecutor, f: { page: number; action?: string; entityType?: string; runId?: string; entityId?: string }) {
  const where = and(
    f.action ? sql`${agentActions.action} = ${f.action}` : undefined,
    f.entityType ? eq(agentActions.entityType, f.entityType) : undefined,
    f.runId ? eq(agentActions.runId, f.runId) : undefined,
    f.entityId ? eq(agentActions.entityId, f.entityId) : undefined,
  );
  const rows = await db
    .select()
    .from(agentActions)
    .where(where)
    .orderBy(desc(agentActions.createdAt), desc(agentActions.id))
    .limit(LOG_PAGE_SIZE + 1)
    .offset(f.page * LOG_PAGE_SIZE);
  const facets = await db
    .select({ action: agentActions.action, entityType: agentActions.entityType, n: sql<number>`count(*)::int` })
    .from(agentActions)
    .groupBy(agentActions.action, agentActions.entityType);
  return { rows: rows.slice(0, LOG_PAGE_SIZE), hasMore: rows.length > LOG_PAGE_SIZE, facets };
}

export async function proposals(db: DbExecutor) {
  const pending = await db.select().from(agentActions).where(eq(agentActions.approvalStatus, "pending")).orderBy(agentActions.createdAt);
  const decided = await db
    .select()
    .from(agentActions)
    .where(and(isNotNull(agentActions.reviewedAt), sql`${agentActions.action} like 'propose_%'`))
    .orderBy(desc(agentActions.reviewedAt))
    .limit(20);
  return { pending, decided };
}
