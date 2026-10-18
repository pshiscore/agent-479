import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { Deadline } from "@/lib/cron-budget";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, venues, weatherAlerts, weatherGrids, weatherState } from "@/lib/db/schema";
import { PoliteClient } from "@/lib/sources/http";
import { clearWeatherBlock, runWeatherJob } from "@/lib/weather/job";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const T0 = new Date("2026-10-18T15:00:00Z");
const later = (min: number) => new Date(T0.getTime() + min * 60_000);

/** A fake NWS: robots.txt disallows everything, like the real one; the exception lets the job through. */
function nws(state: { alerts: string[]; status?: number; calls: string[] }) {
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    state.calls.push(url);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /\n");
    if (state.status) return new Response("", { status: state.status });
    if (url.includes("/alerts/active")) return new Response(JSON.stringify({ features: state.alerts.map((id) => ({ geometry: null, properties: { id, event: "Frost Advisory", severity: "Minor", geocode: { UGC: ["ARZ001"] } } })) }));
    return new Response(JSON.stringify({ properties: { updateTime: T0.toISOString(), periods: [0, 1, 2].map((h) => ({ startTime: new Date(T0.getTime() + h * 3_600_000).toISOString(), isDaytime: true, temperature: 70 + h, temperatureUnit: "F", probabilityOfPrecipitation: { value: 10 }, icon: "https://api.weather.gov/icons/land/day/few?size=small", shortForecast: "Sunny" })) } }));
  }) as typeof globalThis.fetch;
  return new PoliteClient({ fetch, userAgent: "Agent479Bot/test", minGapMs: 0, sleep: async () => {} });
}

async function setup(tx: DbTx) {
  // Only our two test squares: any dev venue grids are cleared inside this rollback.
  await tx.update(venues).set({ nwsOffice: null, nwsGridX: null, nwsGridY: null });
  const mk = (slug: string, x: number) => tx.insert(venues).values({ slug, name: slug, city: "Rogers", lat: 36.33, lng: -94.12, address: "1 Sky St", venueType: "park", nwsOffice: "TSA", nwsGridX: x, nwsGridY: 120 });
  await mk("test-sky-a", 68);
  await mk("test-sky-b", 68);
  await mk("test-sky-c", 69);
}

describe("weather job", () => {
  it("fetches each square and the alerts every 2 hours, and drops alerts NWS stops listing", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const web = { alerts: ["urn:a", "urn:b"], calls: [] as string[] };
      const s1 = await runWeatherJob(tx, { now: T0, http: nws(web), deadline: new Deadline(60_000) });
      expect(s1).toMatchObject({ squares: 2, forecastsFetched: 2, alertsFetched: true, alertsActive: 2, blocked: null });
      const [g] = await tx.select().from(weatherGrids).where(eq(weatherGrids.gridX, 68));
      expect(g.hours.map((h) => h.tempF)).toEqual([70, 71, 72]);
      expect(g.hours[0]).toMatchObject({ code: "few", popPct: 10 });

      // 30 minutes later: nothing due.
      const s2 = await runWeatherJob(tx, { now: later(30), http: nws(web), deadline: new Deadline(60_000) });
      expect(s2).toMatchObject({ forecastsFetched: 0, alertsFetched: false });

      // 2 hours later: fetched again; one alert has ended.
      web.alerts = ["urn:b"];
      const s3 = await runWeatherJob(tx, { now: later(121), http: nws(web), deadline: new Deadline(60_000) });
      expect(s3).toMatchObject({ forecastsFetched: 2, alertsActive: 1, alertsRemoved: 1 });
      expect((await tx.select().from(weatherAlerts)).map((a) => a.nwsId)).toEqual(["urn:b"]);
    });
  });

  it("a block stops this run and every later one until the owner clears it (logged)", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const web: { alerts: string[]; status?: number; calls: string[] } = { alerts: [], status: 403, calls: [] };
      const s1 = await runWeatherJob(tx, { now: T0, http: nws(web), deadline: new Deadline(60_000) });
      expect(s1?.blocked).toMatch(/403/);
      const [state] = await tx.select().from(weatherState).where(eq(weatherState.id, 1));
      expect(state.blockedAt).toEqual(T0);

      web.calls.length = 0;
      const s2 = await runWeatherJob(tx, { now: later(180), http: nws(web), deadline: new Deadline(60_000) });
      expect(s2?.blocked).toMatch(/stopped: blocked/);
      expect(web.calls).toEqual([]);

      await expect(clearWeatherBlock(tx, { actor: "agent:weather", note: "fine" })).rejects.toThrow(/only the owner/);
      await clearWeatherBlock(tx, { actor: "human:owner", note: "NWS outage over" });
      const [log] = await tx.select().from(agentActions).where(eq(agentActions.entityId, state.runId!));
      expect(log.reason).toMatch(/cleared by the owner: NWS outage over/);
      web.status = undefined;
      expect(await runWeatherJob(tx, { now: later(240), http: nws(web), deadline: new Deadline(60_000) })).toMatchObject({ blocked: null, forecastsFetched: 2 });
    });
  });

  it("out of time, it stops cleanly and the squares stay due", async () => {
    await inRollback(async (tx) => {
      await setup(tx);
      const s = await runWeatherJob(tx, { now: T0, http: nws({ alerts: [], calls: [] }), deadline: new Deadline(0) });
      expect(s).toMatchObject({ forecastsFetched: 0, forecastsLeft: 2, stoppedForTime: true });
    });
  });
});
