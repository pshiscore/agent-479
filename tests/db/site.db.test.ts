import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { agentActor } from "@/lib/actions/record";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, categories, eventDays, eventSources, events, homepageFeatures, sources, venues } from "@/lib/db/schema";
import { selectFeature } from "@/lib/pipeline/feature";
import { listEvents } from "@/lib/site/queries";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const tag = randomUUID().slice(0, 8);
const NOW = new Date("2027-09-01T12:00:00Z");

async function add(tx: DbTx, sourceSlug: string, venueSlug: string, title: string, iso: string) {
  const [src] = await tx.select().from(sources).where(eq(sources.slug, sourceSlug));
  const [venue] = await tx.select().from(venues).where(eq(venues.slug, venueSlug));
  const [cat] = await tx.select().from(categories).where(eq(categories.slug, "music"));
  const [e] = await tx
    .insert(events)
    .values({ slug: `site-${tag}-${randomUUID().slice(0, 6)}`, title, normalizedTitle: title.toLowerCase(), startAt: new Date(iso), venueId: venue.id, categoryId: cat.id, firstSeenAt: new Date("2027-08-30T12:00:00Z") })
    .returning();
  await tx.insert(eventSources).values({ eventId: e.id, sourceId: src.id, externalId: `site-${tag}-${randomUUID()}`, isPrimary: true });
  return e;
}

describe("public lists", () => {
  it("hide Ticketmaster events while the site is unlocked and their display isn't approved", async () => {
    await inRollback(async (tx) => {
      const city = await add(tx, "city-rogers", "rogers-historical-museum", "Museum Night", "2027-09-03T23:00:00Z");
      const tm = await add(tx, "ticketmaster", "walmart-amp", "Big Concert", "2027-09-03T23:30:00Z");
      const ids = (await listEvents(tx, { from: new Date("2027-09-03T00:00:00Z"), to: new Date("2027-09-04T12:00:00Z") })).map((e) => e.id);
      expect(ids).toContain(city.id);
      expect(ids).not.toContain(tm.id); // tests run unlocked, outside production
    });
  });
});

describe("multi-day events", () => {
  it("lists a festival that started before the view, with its stated hours; not one that already ended", async () => {
    await inRollback(async (tx) => {
      // Thu Sep 2 8 am to Sun Sep 5 5 pm (Chicago), viewed from Saturday.
      const fair = await add(tx, "city-rogers", "rogers-historical-museum", `Fair ${tag}`, "2027-09-02T13:00:00Z");
      await tx.update(events).set({ endAt: new Date("2027-09-05T22:00:00Z") }).where(eq(events.id, fair.id));
      await tx.insert(eventDays).values({ eventId: fair.id, day: "2027-09-04", opensAt: new Date("2027-09-04T13:00:00Z"), closesAt: new Date("2027-09-04T22:00:00Z") });
      const past = await add(tx, "city-rogers", "rogers-historical-museum", `Done ${tag}`, "2027-09-01T13:00:00Z");
      const items = await listEvents(tx, { from: new Date("2027-09-04T05:00:00Z"), to: new Date("2027-09-06T05:00:00Z") });
      const listed = items.find((e) => e.id === fair.id);
      expect(listed?.days).toEqual([{ day: "2027-09-04", opensAt: new Date("2027-09-04T13:00:00Z"), closesAt: new Date("2027-09-04T22:00:00Z") }]);
      expect(items.map((e) => e.id)).not.toContain(past.id);
    });
  });
});

describe("selectFeature", () => {
  it("logs a new feature only when the winner changes, with the rules that chose it", async () => {
    await inRollback(async (tx) => {
      const amp = await add(tx, "city-rogers", "walmart-amp", "Amp Show", "2027-09-05T01:00:00Z");
      await add(tx, "city-rogers", "rogers-historical-museum", "Museum Talk", "2027-09-02T01:00:00Z");
      const actor = agentActor("process");
      const first = await selectFeature(tx, { now: NOW, actor });
      expect(first).toEqual({ changed: true, eventId: amp.id });
      const [row] = await tx.select().from(homepageFeatures).where(eq(homepageFeatures.eventId, amp.id));
      expect(row.rules).toEqual({ newlyAnnounced: true, largeVenue: true });
      const [log] = await tx.select().from(agentActions).where(eq(agentActions.entityId, row.id));
      expect(log.reason).toMatch(/rules met: newlyAnnounced, largeVenue/);
      expect(await selectFeature(tx, { now: NOW, actor })).toEqual({ changed: false, eventId: amp.id });
    });
  });
});
