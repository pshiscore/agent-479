import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { agentActions, venues } from "@/lib/db/schema";
import { PoliteClient } from "@/lib/sources/http";
import { refreshVenueGrids, venuesDueForGrid } from "@/lib/weather/grid";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

/** A fake api.weather.gov whose robots.txt disallows everything (as the real one does). */
function nws(grid: () => { x: number; y: number } | number) {
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /\n");
    const g = grid();
    if (typeof g === "number") return new Response("", { status: g });
    return new Response(JSON.stringify({ properties: { gridId: "TSA", gridX: g.x, gridY: g.y, forecastZone: "https://api.weather.gov/zones/forecast/ARZ001", county: "https://api.weather.gov/zones/county/ARC007" } }), { headers: { "content-type": "application/geo+json" } });
  }) as typeof globalThis.fetch;
  return new PoliteClient({ fetch, userAgent: "Agent479Bot/test", minGapMs: 0, sleep: async () => {} });
}

describe("venue forecast grids", () => {
  it("maps active venues once a month, logs every venue change, and logs a moved grid", async () => {
    await inRollback(async (tx) => {
      // Only our two test venues are due: everything else counts as checked this month.
      await tx.update(venues).set({ nwsPointsCheckedAt: new Date("2099-01-01T00:00:00Z") });
      const mk = (slug: string, active = true) => tx.insert(venues).values({ slug, name: slug, city: "Rogers", lat: 36.33, lng: -94.12, address: "1 Grid St", venueType: "park", active }).returning().then((r) => r[0]);
      const a = await mk("test-grid-a");
      await mk("test-grid-off", false);
      const nov2 = new Date("2026-11-02T15:00:00Z");
      expect((await venuesDueForGrid(tx, nov2)).map((v) => v.slug)).toEqual(["test-grid-a"]);

      let grid: { x: number; y: number } | number = { x: 68, y: 120 };
      const s1 = await refreshVenueGrids(tx, { http: nws(() => grid), actor: "agent:weather", runId: null, now: nov2 });
      expect(s1).toMatchObject({ due: 1, checked: 1, changed: 1, failed: 0, blocked: null });
      const [after] = await tx.select().from(venues).where(eq(venues.id, a.id));
      expect(after).toMatchObject({ nwsOffice: "TSA", nwsGridX: 68, nwsGridY: 120, nwsForecastZone: "ARZ001", nwsCountyZone: "ARC007" });
      expect(await venuesDueForGrid(tx, new Date("2026-11-25T15:00:00Z"))).toEqual([]);

      // Next month NWS has moved the grid: updated and logged with before and after.
      grid = { x: 69, y: 120 };
      const s2 = await refreshVenueGrids(tx, { http: nws(() => grid), actor: "agent:weather", runId: null, now: new Date("2026-12-01T15:00:00Z") });
      expect(s2).toMatchObject({ checked: 1, changed: 1 });
      const logs = await tx.select().from(agentActions).where(and(eq(agentActions.entityType, "venue"), inArray(agentActions.entityId, [a.id])));
      expect(logs.map((l) => l.reason)).toEqual(expect.arrayContaining([expect.stringMatching(/none → TSA\/68,120/), expect.stringMatching(/TSA\/68,120 → TSA\/69,120/)]));
    });
  });

  it("waits out server errors and stops on a block", async () => {
    await inRollback(async (tx) => {
      await tx.update(venues).set({ nwsPointsCheckedAt: new Date("2099-01-01T00:00:00Z") });
      await tx.insert(venues).values({ slug: "test-grid-b", name: "b", city: "Rogers", lat: 36.33, lng: -94.12, address: "1 Grid St", venueType: "park" });
      const nov2 = new Date("2026-11-02T15:00:00Z");
      expect(await refreshVenueGrids(tx, { http: nws(() => 503), actor: "agent:weather", runId: null, now: nov2 })).toMatchObject({ checked: 0, failed: 1, blocked: null });
      expect(await refreshVenueGrids(tx, { http: nws(() => 403), actor: "agent:weather", runId: null, now: nov2 })).toMatchObject({ checked: 0, blocked: expect.stringMatching(/403/) });
      expect(await venuesDueForGrid(tx, nov2)).toHaveLength(1);
    });
  });
});
