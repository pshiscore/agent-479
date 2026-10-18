import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { recordAction } from "@/lib/actions/record";
import type { Deadline } from "@/lib/cron-budget";
import type { DbExecutor } from "@/lib/db/client";
import { venues } from "@/lib/db/schema";
import { monthStart } from "@/lib/discovery/rediscover";
import { FetchBlockedError, FetchNotPermittedError } from "@/lib/http/fetch";
import { FetchFailedError, type PoliteClient } from "@/lib/sources/http";

/**
 * NWS forecast grids for our venues (event weather, step 3). Each active
 * venue's signed-off coordinates go to /points once; the grid square and the
 * forecast and county zones are stored on the venue (venue data: every change
 * is logged). Due again each Chicago month, since NWS can move grids. Never
 * re-geocodes: the coordinates are ours.
 */

const API = "https://api.weather.gov";

export interface PointsGrid {
  office: string;
  x: number;
  y: number;
  forecastZone: string | null;
  countyZone: string | null;
}

const lastPart = (u: unknown) => (typeof u === "string" && u ? (u.split("/").pop() ?? null) : null);

/** Pure: the grid and zones from a /points response. */
export function parsePoints(body: string): PointsGrid {
  const p = (JSON.parse(body) as { properties?: Record<string, unknown> }).properties;
  if (!p || typeof p.gridId !== "string" || typeof p.gridX !== "number" || typeof p.gridY !== "number") throw new Error("no forecast grid in the /points response");
  return { office: p.gridId, x: p.gridX, y: p.gridY, forecastZone: lastPart(p.forecastZone), countyZone: lastPart(p.county) };
}

/** /points takes at most four decimals (and redirects otherwise). */
export const pointsUrl = (lat: number, lng: number) => `${API}/points/${lat.toFixed(4)},${lng.toFixed(4)}`;

export async function venuesDueForGrid(db: DbExecutor, now: Date) {
  return db
    .select()
    .from(venues)
    .where(and(eq(venues.active, true), or(isNull(venues.nwsPointsCheckedAt), lt(venues.nwsPointsCheckedAt, monthStart(now)))))
    .orderBy(asc(venues.slug));
}

/** Maps due venues to their grids until the deadline. A block stops the job; timeouts and 5xx wait for the next run. */
export async function refreshVenueGrids(db: DbExecutor, opts: { http: PoliteClient; actor: string; runId: string | null; now?: Date; deadline?: Deadline }) {
  const now = opts.now ?? new Date();
  const due = await venuesDueForGrid(db, now);
  const stats = { due: due.length, checked: 0, changed: 0, failed: 0, blocked: null as string | null, remaining: 0 };
  for (const v of due) {
    if (opts.deadline?.passed) break;
    let grid: PointsGrid;
    try {
      const res = await opts.http.get(pointsUrl(v.lat, v.lng), "application/geo+json");
      grid = parsePoints(res.text);
    } catch (err) {
      if (err instanceof FetchBlockedError || err instanceof FetchNotPermittedError) {
        stats.blocked = err.message.slice(0, 300);
        break;
      }
      if (!(err instanceof FetchFailedError) && !(err instanceof SyntaxError) && !(err instanceof Error && /forecast grid/.test(err.message))) throw err;
      stats.failed++;
      continue;
    }
    const changed = v.nwsOffice !== grid.office || v.nwsGridX !== grid.x || v.nwsGridY !== grid.y || v.nwsForecastZone !== grid.forecastZone || v.nwsCountyZone !== grid.countyZone;
    await db.transaction(async (tx) => {
      const [after] = await tx
        .update(venues)
        .set({ nwsOffice: grid.office, nwsGridX: grid.x, nwsGridY: grid.y, nwsForecastZone: grid.forecastZone, nwsCountyZone: grid.countyZone, nwsPointsCheckedAt: now, updatedAt: now })
        .where(eq(venues.id, v.id))
        .returning();
      const was = v.nwsOffice ? `${v.nwsOffice}/${v.nwsGridX},${v.nwsGridY}` : "none";
      await recordAction(tx, {
        actor: opts.actor,
        runId: opts.runId,
        action: "update",
        entityType: "venue",
        entityId: v.id,
        before: v,
        after,
        reason: changed ? `NWS forecast grid ${was} → ${grid.office}/${grid.x},${grid.y} (zones ${grid.forecastZone}, ${grid.countyZone})` : `NWS forecast grid checked, unchanged (${grid.office}/${grid.x},${grid.y})`,
      });
    });
    stats.checked++;
    if (changed) stats.changed++;
  }
  stats.remaining = due.length - stats.checked - stats.failed;
  return stats;
}
