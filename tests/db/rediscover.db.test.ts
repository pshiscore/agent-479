import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { agentActor } from "@/lib/actions/record";
import { Deadline } from "@/lib/cron-budget";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, feedDiscoveries, organizers } from "@/lib/db/schema";
import { dueForDiscovery, monthStart, rediscoverDue } from "@/lib/discovery/rediscover";
import { PoliteClient } from "@/lib/sources/http";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

// Two made-up sites: one with an iCal feed, one that refuses robots.txt.
const SITE: Record<string, { status?: number; type: string; body: string }> = {
  "https://cider.example/robots.txt": { type: "text/plain", body: "User-agent: *\nAllow: /\n" },
  "https://cider.example/": { type: "text/html", body: `<html><head><link rel="alternate" type="text/calendar" title="Cider Events" href="https://cider.example/events.ics"></head><body>Cider</body></html>` },
  "https://cider.example/events.ics": { type: "text/calendar", body: ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:1", "SUMMARY:Cider Tasting", "DTSTART:20261105T180000", "END:VEVENT", "END:VCALENDAR"].join("\r\n") },
  "https://refuses.example/robots.txt": { status: 403, type: "text/plain", body: "" },
};
const fakeFetch = (async (input: string | URL | Request) => {
  const page = SITE[String(input instanceof Request ? input.url : input)];
  return new Response(page?.body ?? "not found", { status: page ? (page.status ?? 200) : 404, headers: { "content-type": page?.type ?? "text/plain" } });
}) as typeof fetch;
const http = () => new PoliteClient({ fetch: fakeFetch, userAgent: "Agent479Bot/test", minGapMs: 0, sleep: async () => {} });
const open = () => new Deadline(60_000);

async function orgs(tx: DbTx) {
  // Keep only our test organizers due: the dev database's own were checked "now".
  await tx.update(organizers).set({ discoveryCheckedAt: new Date("2099-01-01T00:00:00Z") });
  const make = (slug: string, website: string) =>
    tx.insert(organizers).values({ slug, name: slug, organizerType: "business", website, city: "Springdale", status: "verified", lastCheckedAt: new Date() }).returning().then((r) => r[0]);
  return { cider: await make("test-cider", "https://cider.example/"), refuses: await make("test-refuses", "https://refuses.example/") };
}

describe("monthly re-discovery", () => {
  it("monthStart is the 1st at Chicago midnight", () => {
    expect(monthStart(new Date("2026-11-01T05:30:00Z"))).toEqual(new Date("2026-11-01T05:00:00Z"));
    // 11 pm on Oct 31 in Chicago is still October.
    expect(monthStart(new Date("2026-11-01T04:00:00Z"))).toEqual(new Date("2026-10-01T05:00:00Z"));
  });

  it("checks due organizers once a month, proposes new feeds, records a block, and never retries it", async () => {
    await inRollback(async (tx) => {
      const { cider, refuses } = await orgs(tx);
      const nov2 = new Date("2026-11-02T15:00:00Z");
      expect((await dueForDiscovery(tx, nov2)).map((o) => o.slug).sort()).toEqual(["test-cider", "test-refuses"]);

      const stats = await rediscoverDue(tx, { deadline: open(), http: http(), actor: agentActor("discovery"), runId: null, now: nov2 });
      expect(stats).toEqual({ due: 2, checked: 1, proposed: 1, gone: 0, blocked: 1, remaining: 0 });
      const [found] = await tx.select().from(feedDiscoveries).where(eq(feedDiscoveries.organizerId, cider.id));
      expect(found).toMatchObject({ url: "https://cider.example/events.ics", status: "proposed" });
      const [blocked] = await tx.select().from(organizers).where(eq(organizers.id, refuses.id));
      expect(blocked.discoveryBlocked).toMatch(/robots.txt|Blocked/i);
      const logs = await tx.select().from(agentActions).where(and(eq(agentActions.entityType, "organizer"), eq(agentActions.entityId, refuses.id)));
      expect(logs.some((l) => /not retried/.test(l.reason))).toBe(true);

      // Same month: nothing due. Next month: the checked one is due again; the blocked one never is.
      expect(await dueForDiscovery(tx, new Date("2026-11-20T15:00:00Z"))).toEqual([]);
      expect((await dueForDiscovery(tx, new Date("2026-12-01T15:00:00Z"))).map((o) => o.slug)).toEqual(["test-cider"]);
    });
  });

  it("out of time: nothing is checked or stamped, so the next daily run picks up where this one stopped", async () => {
    await inRollback(async (tx) => {
      await orgs(tx);
      const nov2 = new Date("2026-11-02T15:00:00Z");
      const stats = await rediscoverDue(tx, { deadline: new Deadline(0), http: http(), actor: agentActor("discovery"), runId: null, now: nov2 });
      expect(stats).toMatchObject({ due: 2, checked: 0, remaining: 2 });
      expect(await dueForDiscovery(tx, nov2)).toHaveLength(2);
    });
  });
});
