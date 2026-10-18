import { and, asc, eq, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import { Deadline } from "@/lib/cron-budget";
import type { DbExecutor } from "@/lib/db/client";
import { venues, weatherAlerts, weatherCities, weatherGrids, weatherState } from "@/lib/db/schema";
import { FetchBlockedError, FetchNotPermittedError } from "@/lib/http/fetch";
import { claimJob } from "@/lib/jobs";
import { finishRun } from "@/lib/runs";
import { FetchFailedError, PoliteClient } from "@/lib/sources/http";
import { ALERTS_URL, hourlyUrl, parseAlerts, parseHourly } from "./nws";

/**
 * The weather job (every 30 minutes; event weather, step 4). Fetches each
 * forecast grid square's hourly forecast and Arkansas's active alerts when
 * they're more than 2 hours old, one request at a time, inside the cron time
 * budget. Bulk data (AGENTS.md rule 2's exception): counts go in runs.stats and
 * each row carries its run. A block sets weather_state.blocked_* and every
 * later run stops at once until the owner clears it.
 */

export const REFRESH_MS = 2 * 60 * 60 * 1000;
// Hours already past are dropped, keeping one so an event that started this hour still finds its weather.
const KEEP_PAST_MS = 60 * 60 * 1000;

export async function weatherSquares(db: DbExecutor) {
  const fromVenues = await db
    .selectDistinct({ office: venues.nwsOffice, x: venues.nwsGridX, y: venues.nwsGridY })
    .from(venues)
    .where(and(eq(venues.active, true), isNotNull(venues.nwsOffice)));
  const fromCities = await db.selectDistinct({ office: weatherCities.nwsOffice, x: weatherCities.nwsGridX, y: weatherCities.nwsGridY }).from(weatherCities).where(isNotNull(weatherCities.nwsOffice));
  const all = new Map<string, { office: string; x: number; y: number }>();
  for (const s of [...fromVenues, ...fromCities]) all.set(`${s.office}/${s.x},${s.y}`, { office: s.office!, x: s.x!, y: s.y! });
  return [...all.values()];
}

export async function runWeatherJob(db: DbExecutor, opts: { now?: Date; http?: PoliteClient; deadline?: Deadline } = {}) {
  const now = opts.now ?? new Date();
  const deadline = opts.deadline ?? new Deadline();
  const claim = await claimJob(db, "weather", { now });
  if (!claim) return null;
  const stats = { squares: 0, forecastsFetched: 0, forecastsFailed: 0, forecastsLeft: 0, alertsFetched: false, alertsActive: 0, alertsRemoved: 0, blocked: null as string | null, stoppedForTime: false };
  try {
    await db.insert(weatherState).values({ id: 1 }).onConflictDoNothing();
    const [state] = await db.select().from(weatherState).where(eq(weatherState.id, 1));
    if (state.blockedAt) {
      stats.blocked = `stopped: blocked since ${state.blockedAt.toISOString()} (${state.blockedReason}); the owner clears it`;
      await finishRun(db, claim.id, { status: "partial", stats });
      return stats;
    }
    const http = opts.http ?? new PoliteClient({ timeoutMs: 20_000 });
    const block = async (err: Error) => {
      stats.blocked = err.message.slice(0, 300);
      await db.update(weatherState).set({ blockedAt: now, blockedReason: stats.blocked, runId: claim.id }).where(eq(weatherState.id, 1));
    };

    // Squares: every one our venues and header cities fall in; new ones get a row.
    const squares = await weatherSquares(db);
    stats.squares = squares.length;
    for (const s of squares) await db.insert(weatherGrids).values({ office: s.office, gridX: s.x, gridY: s.y }).onConflictDoNothing();
    const due = await db
      .select()
      .from(weatherGrids)
      .where(and(or(isNull(weatherGrids.fetchedAt), lt(weatherGrids.fetchedAt, new Date(now.getTime() - REFRESH_MS))), inArray(sql`${weatherGrids.office} || '/' || ${weatherGrids.gridX} || ',' || ${weatherGrids.gridY}`, squares.map((s) => `${s.office}/${s.x},${s.y}`))))
      .orderBy(sql`${weatherGrids.fetchedAt} asc nulls first`, asc(weatherGrids.office));

    for (const g of due) {
      if (deadline.passed) {
        stats.stoppedForTime = true;
        break;
      }
      try {
        const res = await http.get(hourlyUrl(g.office, g.gridX, g.gridY), "application/geo+json");
        const { updatedAt, hours } = parseHourly(res.text, new Date(now.getTime() - KEEP_PAST_MS));
        await db.update(weatherGrids).set({ hours, nwsUpdatedAt: updatedAt, fetchedAt: now, runId: claim.id, updatedAt: now }).where(eq(weatherGrids.id, g.id));
        stats.forecastsFetched++;
      } catch (err) {
        if (err instanceof FetchBlockedError || err instanceof FetchNotPermittedError) {
          await block(err);
          break;
        }
        // NWS hourly forecasts fail now and then (5xx, timeouts, odd bodies): the next run tries again.
        if (err instanceof FetchFailedError || err instanceof SyntaxError || (err instanceof Error && /no periods/.test(err.message))) stats.forecastsFailed++;
        else throw err;
      }
    }
    stats.forecastsLeft = due.length - stats.forecastsFetched - stats.forecastsFailed;

    // Alerts: on the same 2-hour rhythm, if there's time and no block.
    const alertsDue = !state.alertsFetchedAt || now.getTime() - state.alertsFetchedAt.getTime() >= REFRESH_MS;
    if (alertsDue && !stats.blocked && !deadline.passed) {
      try {
        const res = await http.get(ALERTS_URL, "application/geo+json");
        const alerts = parseAlerts(res.text);
        for (const a of alerts) {
          const values = { event: a.event, severity: a.severity, onsetAt: a.onsetAt, endsAt: a.endsAt, geometry: a.geometry, zones: a.zones, lastSeenAt: now, runId: claim.id, updatedAt: now };
          await db.insert(weatherAlerts).values({ nwsId: a.nwsId, firstSeenAt: now, ...values }).onConflictDoUpdate({ target: weatherAlerts.nwsId, set: values });
        }
        // NWS no longer lists them: they're over (or cancelled).
        const removed = await db
          .delete(weatherAlerts)
          .where(alerts.length ? notInArray(weatherAlerts.nwsId, alerts.map((a) => a.nwsId)) : sql`true`)
          .returning({ id: weatherAlerts.id });
        await db.update(weatherState).set({ alertsFetchedAt: now, runId: claim.id }).where(eq(weatherState.id, 1));
        stats.alertsFetched = true;
        stats.alertsActive = alerts.length;
        stats.alertsRemoved = removed.length;
      } catch (err) {
        if (err instanceof FetchBlockedError || err instanceof FetchNotPermittedError) await block(err);
        else if (!(err instanceof FetchFailedError || err instanceof SyntaxError || (err instanceof Error && /no features/.test(err.message)))) throw err;
      }
    } else if (alertsDue) stats.stoppedForTime ||= deadline.passed;

    await finishRun(db, claim.id, { status: stats.blocked || stats.forecastsFailed || stats.stoppedForTime ? "partial" : "ok", stats: { ...stats, elapsedMs: deadline.elapsedMs } });
    return stats;
  } catch (err) {
    await finishRun(db, claim.id, { status: "failed", error: String(err).slice(0, 2000) });
    throw err;
  }
}

/** The owner clears a block after dealing with it (logged against the run that recorded it). */
export async function clearWeatherBlock(db: DbExecutor, opts: { actor: string; note: string }) {
  if (!opts.actor.startsWith("human:")) throw new Error("only the owner clears a weather block");
  if (opts.note.trim().length < 3) throw new Error("say why it's safe to resume");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(weatherState).where(eq(weatherState.id, 1)).for("update");
    if (!before?.blockedAt || !before.runId) throw new Error("weather isn't blocked");
    const [after] = await tx.update(weatherState).set({ blockedAt: null, blockedReason: null }).where(eq(weatherState.id, 1)).returning();
    await recordAction(tx, { actor: opts.actor, action: "update", entityType: "run", entityId: before.runId, before, after, reason: `Weather block cleared by the owner: ${opts.note.trim()}` });
    return after;
  });
}
