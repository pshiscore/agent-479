import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { groupOf, VENUE_GROUPS } from "@/config/venue-groups";
import { getDb } from "@/lib/db/client";
import { categories, eventSeries, eventSources, events, sources, venues } from "@/lib/db/schema";
import { venueList } from "@/lib/site/venue-list";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const DAY = 86_400_000;

describe("venue list counts", () => {
  it("count the next 30 days, a recurring series once, and never hidden events", async () => {
    await inRollback(async (tx) => {
      const now = new Date();
      const [cat] = await tx.select().from(categories).where(eq(categories.active, true)).limit(1);
      const [src] = await tx.select().from(sources).where(eq(sources.slug, "city-rogers")).limit(1);
      const [venue] = await tx.insert(venues).values({ slug: "test-count-hall", name: "Test Count Hall", city: "Rogers", lat: 36.33, lng: -94.12, address: "1 Count St", venueType: "event_space" }).returning();
      const [series] = await tx.insert(eventSeries).values({ slug: `test-story-time-${Date.now()}`, sourceId: src.id, venueId: venue.id, categoryId: cat.id, normalizedTitle: "test story time", title: "Test Story Time", kind: "recurring", detectedBy: "pattern", recurrenceLabel: "Tuesdays" }).returning();
      let n = 0;
      const add = async (title: string, inDays: number, over: Partial<typeof events.$inferInsert> = {}) => {
        const [ev] = await tx.insert(events).values({ slug: `vl-${++n}-${Date.now()}`, title, normalizedTitle: title.toLowerCase(), startAt: new Date(now.getTime() + inDays * DAY), venueId: venue.id, categoryId: cat.id, ...over }).returning();
        await tx.insert(eventSources).values({ eventId: ev.id, sourceId: src.id, externalId: `vl-${n}-${Date.now()}`, isPrimary: true });
      };
      await add("Concert", 2);
      await add("Fair", 20);
      for (const d of [1, 8, 15, 22]) await add("Test Story Time", d, { seriesId: series.id });
      await add("Hidden Show", 3, { status: "hidden" });
      await add("Far Off", 45);

      const item = (await venueList(tx, now)).find((v) => v.slug === "test-count-hall")!;
      // Concert + Fair + the series once = 3; hidden and 45 days out don't count.
      expect(item).toMatchObject({ upcoming: 3, type: "event_space", group: { slug: "event-spaces" }, city: { slug: "rogers" } });
    });
  });

  it("every active venue in the database belongs to exactly one group", async () => {
    const rows = (await getDb().execute(sql`select slug, venue_type from venues where active`)) as unknown as { slug: string; venue_type: string }[];
    for (const r of rows) {
      expect(VENUE_GROUPS.filter((g) => (g.types as readonly string[]).includes(r.venue_type)), r.slug).toHaveLength(1);
      expect(groupOf(r.venue_type), r.slug).not.toBeNull();
    }
  });
});
