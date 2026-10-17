import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { type DbTx, getDb } from "@/lib/db/client";
import { categories, eventSources, events, sources, venues } from "@/lib/db/schema";
import { cityBySlug, citySlugs, filterOptions, listEvents, venueBySlug } from "@/lib/site/queries";
import { venueList } from "@/lib/site/venue-list";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

// Owner, 2026-10-17: inactive venues (and venues outside the coverage area) never appear on a public page.
async function fixtures(tx: DbTx) {
  const [cat] = await tx.select().from(categories).where(eq(categories.active, true)).limit(1);
  const [src] = await tx.select().from(sources).limit(1);
  const venue = (slug: string, city: string, active: boolean) =>
    tx.insert(venues).values({ slug, name: slug, city, active, lat: 36.3, lng: -94.1, address: "1 Test St", venueType: "theater" }).returning().then((r) => r[0]);
  const closed = await venue("test-closed-hall", "Rogers", false);
  const away = await venue("test-away-theater", "Eureka Springs", true);
  const open = await venue("test-open-hall", "Rogers", true);
  const start = new Date(Date.now() + 3 * 86_400_000);
  let n = 0;
  for (const v of [closed, away, open]) {
    const [ev] = await tx.insert(events).values({ slug: `pv-${++n}-${Date.now()}`, title: `Show at ${v.slug}`, normalizedTitle: `show at ${v.slug}`, startAt: start, venueId: v.id, categoryId: cat.id }).returning();
    await tx.insert(eventSources).values({ eventId: ev.id, sourceId: src.id, externalId: `pv-${n}-${Date.now()}`, isPrimary: true });
  }
  return { closed, away, open, start };
}

describe("public venues", () => {
  it("never show an inactive or out-of-area venue, its city, or its events", async () => {
    await inRollback(async (tx) => {
      const { start } = await fixtures(tx);
      const listed = (await venueList(tx, new Date())).map((v) => v.slug);
      expect(listed).toContain("test-open-hall");
      expect(listed).not.toContain("test-closed-hall");
      expect(listed).not.toContain("test-away-theater");

      expect(await venueBySlug(tx, "test-open-hall")).not.toBeNull();
      expect(await venueBySlug(tx, "test-closed-hall")).toBeNull();
      expect(await venueBySlug(tx, "test-away-theater")).toBeNull();

      expect((await citySlugs(tx)).has("eureka-springs")).toBe(false);
      expect(await cityBySlug(tx, "eureka-springs")).toBeNull();
      expect((await filterOptions(tx)).cities.map((c) => c.slug)).not.toContain("eureka-springs");

      const titles = (await listEvents(tx, { from: new Date(start.getTime() - 86_400_000), to: new Date(start.getTime() + 86_400_000) })).map((e) => e.title);
      expect(titles).not.toContain("Show at test-closed-hall");
      expect(titles).not.toContain("Show at test-away-theater");
    });
  });
});
