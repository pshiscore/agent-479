import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { proposeOnce } from "@/lib/actions/record";
import type { DbExecutor } from "@/lib/db/client";
import { agentActions } from "@/lib/db/schema";

/**
 * Community is the last-resort category, and every Community pick logs a
 * "closest missing category" hint. When one theme passes 15 distinct events
 * in 30 days, propose a category to the owner (never add one).
 */

export const THEME_THRESHOLD = 15;
const THEME_WINDOW_DAYS = 30;
// Words that describe the format, not the theme ("Blood donation drives" = "Blood donation").
const GENERIC = new Set(["event", "program", "drive", "activity", "series", "class", "session", "meetup", "opportunity"]);

export function themeOf(hint: string): string {
  return hint
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .filter((w) => !GENERIC.has(w))
    .join(" ");
}

export async function proposeCategoriesFromHints(db: DbExecutor, opts: { actor: string; now: Date; runId?: string | null }) {
  const since = new Date(opts.now.getTime() - THEME_WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select({ eventId: agentActions.entityId, hint: sql<string>`${agentActions.after}->'_meta'->>'closestMissingCategory'` })
    .from(agentActions)
    .where(
      and(
        eq(agentActions.entityType, "event"),
        inArray(agentActions.action, ["insert", "update"]),
        gte(agentActions.createdAt, since),
        sql`${agentActions.after}->'_meta'->>'closestMissingCategory' is not null`,
      ),
    );
  const themes = new Map<string, { events: Set<string>; hints: Set<string> }>();
  for (const r of rows) {
    if (!r.eventId || !r.hint || r.hint === "unknown") continue;
    const theme = themeOf(r.hint);
    if (!theme) continue;
    const t = themes.get(theme) ?? { events: new Set(), hints: new Set() };
    t.events.add(r.eventId);
    t.hints.add(r.hint);
    themes.set(theme, t);
  }
  let proposed = 0;
  for (const [theme, t] of themes) {
    if (t.events.size < THEME_THRESHOLD) continue;
    const dedupeKey = `category:${theme}`;
    const [rejected] = await db
      .select({ id: agentActions.id })
      .from(agentActions)
      .where(and(eq(agentActions.action, "propose_category"), eq(agentActions.dedupeKey, dedupeKey), eq(agentActions.approvalStatus, "rejected")))
      .limit(1);
    if (rejected) continue;
    const row = await proposeOnce(db, {
      runId: opts.runId ?? null,
      actor: opts.actor,
      action: "propose_category",
      entityType: "category",
      approvalStatus: "pending",
      dedupeKey,
      after: { theme, events: t.events.size, hints: [...t.hints].slice(0, 10), windowDays: THEME_WINDOW_DAYS },
      reason: `${t.events.size} Community events in ${THEME_WINDOW_DAYS} days share the theme "${theme}"`,
    });
    if (row) proposed++;
  }
  return { proposed, themes: themes.size };
}
