import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { agentActor } from "@/lib/actions/record";
import { getDb } from "@/lib/db/client";
import { agentActions, feedDiscoveries, organizers, sources } from "@/lib/db/schema";
import { discoverOrganizer, feedKey, knownFeedKeys } from "@/lib/discovery/discover";
import { approveDiscovery, oneClick, rejectDiscovery, saveFinds } from "@/lib/discovery/store";
import { PoliteClient } from "@/lib/sources/http";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const OWNER = "human:owner";

// A made-up site: a WordPress events plugin, a terms page with flagged phrases,
// an iCal feed, and a Squarespace-style address that robots.txt disallows.
const SITE: Record<string, { status?: number; type: string; body: string }> = {
  "https://brewery.example/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /blocked/\n" },
  "https://brewery.example/": {
    type: "text/html",
    body: `<html><head><link rel="alternate" type="text/calendar" title="Brewery Events" href="https://brewery.example/events/?ical=1">
      <link rel="stylesheet" href="/wp-content/plugins/the-events-calendar/x.css"></head>
      <body><a href="/events/">Events</a><a href="/blocked/cal.ics">Old calendar</a><a href="/terms">Terms of Use</a></body></html>`,
  },
  "https://brewery.example/events/": { type: "text/html", body: `<html><body class="tribe-events">Upcoming</body></html>` },
  "https://brewery.example/terms": { type: "text/html", body: `<p>Do not use automated tools to scrape this site.</p>` },
  "https://brewery.example/events/?ical=1": {
    type: "text/calendar",
    body: ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:a", "SUMMARY:Trivia Night", "DTSTART:20261022T190000", "END:VEVENT", "BEGIN:VEVENT", "UID:b", "SUMMARY:Taproom Closed", "DTSTART:20261026", "END:VEVENT", "END:VCALENDAR"].join("\r\n"),
  },
};

const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  const page = SITE[url];
  return new Response(page?.body ?? "not found", { status: page ? (page.status ?? 200) : 404, headers: { "content-type": page?.type ?? "text/plain" } });
}) as typeof fetch;

const http = () => new PoliteClient({ fetch: fakeFetch, userAgent: "Agent479Bot/test", minGapMs: 0, sleep: async () => {} });

describe("discovery", () => {
  it("finds feeds through robots-checked requests, records terms flags and samples, and skips disallowed ones", async () => {
    const r = await discoverOrganizer(http(), { name: "Test Brewery", website: "https://brewery.example/" }, new Set(), new Date("2026-10-17T12:00:00Z"));
    expect(r.blocked).toBeNull();
    const feed = r.finds.find((f) => f.url === "https://brewery.example/events/?ical=1")!;
    expect(feed).toMatchObject({ kind: "ics", platform: "the_events_calendar", robotsResult: "allowed", termsUrl: "https://brewery.example/terms", suggestedFilters: ["Closed"] });
    expect(feed.termsFlags).toEqual(["automated", "scrape"]);
    expect(feed.sampleEvents.map((s) => s.title)).toEqual(["Trivia Night", "Taproom Closed"]);
    expect(r.skipped).toContainEqual({ label: "iCal link", url: "https://brewery.example/blocked/cal.ics", reason: "robots.txt disallows this address (not read; ask the organizer)" });
    expect(r.finds).toHaveLength(1);

    const again = await discoverOrganizer(http(), { name: "Test Brewery", website: "https://brewery.example/" }, new Set([feedKey("https://brewery.example/events/?ical=1", null)]));
    expect(again.skipped).toContainEqual({ label: "Brewery Events", url: "https://brewery.example/events/?ical=1", reason: "already a source" });
  });

  it("saves proposals (logged), approves into a disabled untested proposed source, and refuses disallowed feeds", async () => {
    await inRollback(async (tx) => {
      const [org] = await tx.insert(organizers).values({ slug: "test-brewery", name: "Test Brewery", organizerType: "business", website: "https://brewery.example/", city: "Rogers", status: "verified", lastCheckedAt: new Date() }).returning();
      const r = await discoverOrganizer(http(), { name: org.name, website: org.website! }, new Set());
      expect(await saveFinds(tx, org.id, r.finds, { actor: agentActor("discovery"), runId: null })).toEqual({ proposed: 1, refreshed: 0, gone: 0 });
      expect(await saveFinds(tx, org.id, r.finds, { actor: agentActor("discovery"), runId: null })).toEqual({ proposed: 0, refreshed: 1, gone: 0 });
      // A disallowed feed saved by hand (or by an earlier run) can't be approved.
      const [blocked] = await tx.insert(feedDiscoveries).values({ organizerId: org.id, url: "https://brewery.example/blocked/cal.ics", kind: "ics", robotsResult: "disallowed", robotsCheckedAt: new Date() }).returning();

      const rows = await tx.select().from(feedDiscoveries).where(eq(feedDiscoveries.organizerId, org.id));
      const ics = rows.find((d) => d.url.endsWith("?ical=1"))!;
      expect(oneClick(ics)).toBe(false);
      await expect(approveDiscovery(tx, ics.id, { actor: OWNER })).rejects.toThrow(/say why the terms are fine/);
      await expect(approveDiscovery(tx, blocked.id, { actor: OWNER, note: "fine" })).rejects.toThrow(/robots.txt disallows/);

      const { source } = await approveDiscovery(tx, ics.id, { actor: OWNER, note: "Read the terms: they bar scraping pages, not subscribing to the published iCal feed. Asking them too." });
      expect(source).toMatchObject({ slug: "test-brewery-ics", fetcher: "ics", kind: "ics", enabled: false, disabledReason: "untested", publishState: "proposed", config: { feedUrl: "https://brewery.example/events/?ical=1" } });
      expect(source.termsNotes).toMatch(/flagged: automated, scrape/);
      const [orgAfter] = await tx.select().from(organizers).where(eq(organizers.id, org.id));
      expect(orgAfter.channel).toBe("feed");
      expect((await knownFeedKeys(tx)).has(feedKey(ics.url, null))).toBe(true);
      const logs = await tx.select().from(agentActions).where(and(eq(agentActions.entityType, "source"), eq(agentActions.entityId, source.id)));
      expect(logs).toHaveLength(1);

      await expect(rejectDiscovery(tx, blocked.id, { actor: OWNER, note: "" })).rejects.toThrow(/say why/);
      expect((await rejectDiscovery(tx, blocked.id, { actor: OWNER, note: "robots.txt says no" })).status).toBe("rejected");

      // A waiting proposal the latest look didn't find is marked gone.
      const [stale] = await tx.insert(feedDiscoveries).values({ organizerId: org.id, url: "https://brewery.example/old.ics", kind: "ics", robotsResult: "allowed", robotsCheckedAt: new Date() }).returning();
      expect((await saveFinds(tx, org.id, [], { actor: agentActor("discovery"), runId: null })).gone).toBe(1);
      const [staleAfter] = await tx.select().from(feedDiscoveries).where(eq(feedDiscoveries.id, stale.id));
      expect(staleAfter.status).toBe("gone");
    });
  });

  it("event data on a page becomes a jsonld source the pipeline can fetch (step 7)", async () => {
    await inRollback(async (tx) => {
      const [org] = await tx.insert(organizers).values({ slug: "test-garden", name: "Test Garden", organizerType: "nonprofit", website: "https://garden.example/", city: "Fayetteville" }).returning();
      const [d] = await tx.insert(feedDiscoveries).values({ organizerId: org.id, url: "https://garden.example/calendar/", label: "Event data on the events page", kind: "page_data", robotsResult: "allowed", robotsCheckedAt: new Date() }).returning();
      const { source } = await approveDiscovery(tx, d.id, { actor: OWNER, note: "No terms page; robots allows the calendar." });
      expect(source).toMatchObject({ slug: "test-garden-page-data", kind: "html", fetcher: "jsonld", config: { pageUrl: "https://garden.example/calendar/" }, enabled: false, disabledReason: "untested", publishState: "proposed" });
    });
  });

  it("a public .gov feed with no flagged terms is one click; CivicPlus calendars get their own config", async () => {
    await inRollback(async (tx) => {
      const [org] = await tx.insert(organizers).values({ slug: "test-town", name: "Town of Test", organizerType: "government", website: "https://www.test.gov/", city: "Gentry" }).returning();
      const [d] = await tx
        .insert(feedDiscoveries)
        .values({ organizerId: org.id, url: "https://www.test.gov/common/modules/iCalendar/iCalendar.aspx?catID=25&feed=calendar", label: "Parks and Recreation", kind: "ics", platform: "civicplus", robotsResult: "allowed", robotsCheckedAt: new Date() })
        .returning();
      expect(oneClick(d)).toBe(true);
      const { source } = await approveDiscovery(tx, d.id, { actor: OWNER });
      expect(source).toMatchObject({ slug: "test-town-cat25", name: "Town of Test: Parks and Recreation", config: { catIds: [25] }, publishState: "proposed" });
      const [again] = await tx.select().from(sources).where(eq(sources.id, source.id));
      expect(again.termsNotes).toMatch(/one click/);
    });
  });
});
