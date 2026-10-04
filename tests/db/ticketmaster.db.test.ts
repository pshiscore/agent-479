import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { humanActor } from "@/lib/actions/record";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, rawRecords, sources, venueExternalIds, venues } from "@/lib/db/schema";
import { storeItems } from "@/lib/pipeline/fetch";
import { purgeStalePayloads } from "@/lib/pipeline/maintenance";
import { startRun } from "@/lib/runs";
import { linkTicketmasterVenue, ticketmasterVenuesInRawRecords } from "@/lib/sources/ticketmaster-venues";
import type { FetchedItem } from "@/lib/sources/types";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const tag = randomUUID().slice(0, 8);

async function addSource(tx: DbTx) {
  const [s] = await tx
    .insert(sources)
    .values({ slug: `tm-test-${tag}`, name: "TM test", kind: "api", fetcher: "ticketmaster", baseUrl: "https://tm.example/", trustLevel: 4, fetchIntervalMinutes: 360, termsNotes: "t" })
    .returning();
  return s;
}

const item = (id: string, venueId: string): FetchedItem => ({
  externalId: id,
  sourceUrl: `https://www.ticketmaster.com/event/${id}`,
  payload: { format: "ticketmaster", event: { id, name: `Show ${id}`, venues: [{ id: venueId, name: "Walmart AMP", city: "Rogers", lat: 36.3, lng: -94.18 }] } },
  descriptionText: null,
  descriptionPurgeAfter: null,
});

describe("payload purge", () => {
  it("purges payloads unseen for 30 days, and re-stores an item that comes back", async () => {
    await inRollback(async (tx) => {
      const s = await addSource(tx);
      const run = await startRun(tx, "fetch", { sourceId: s.id });
      const t0 = new Date("2026-10-01T00:00:00Z");
      await storeItems(tx, s, run.id, [item("E1", "V1"), item("E2", "V1")], t0);
      // E2 is seen again later; E1 isn't.
      const t1 = new Date("2026-10-20T00:00:00Z");
      await storeItems(tx, s, run.id, [item("E2", "V1")], t1);

      // The count includes any real rows past 30 days (rolled back): check this source's rows.
      expect(await purgeStalePayloads(tx, new Date("2026-11-05T00:00:00Z"))).toBeGreaterThanOrEqual(1);
      const rows = await tx.select().from(rawRecords).where(eq(rawRecords.sourceId, s.id));
      const byId = Object.fromEntries(rows.map((r) => [r.externalId, r]));
      expect(byId.E1.payload).toBeNull();
      expect(byId.E2.payload).not.toBeNull();

      // E1 reappears unchanged: its hash matches, but the payload was purged, so it's stored again.
      const back = await storeItems(tx, s, run.id, [item("E1", "V1")], new Date("2026-11-06T00:00:00Z"));
      expect(back).toEqual({ inserted: 0, changed: 1, unchanged: 0 });
      const [e1] = await tx.select().from(rawRecords).where(and(eq(rawRecords.sourceId, s.id), eq(rawRecords.externalId, "E1")));
      expect(e1.payload).not.toBeNull();
    });
  });
});

describe("Ticketmaster venues", () => {
  it("counts venues across stored events, and links one with a logged action", async () => {
    await inRollback(async (tx) => {
      const s = await addSource(tx);
      const run = await startRun(tx, "fetch", { sourceId: s.id });
      await storeItems(tx, s, run.id, [item("E1", "V1"), item("E2", "V1"), item("E3", "V2")], new Date());
      expect((await ticketmasterVenuesInRawRecords(tx, s.id)).map((v) => [v.id, v.events])).toEqual([
        ["V1", 2],
        ["V2", 1],
      ]);

      const [v] = await tx
        .insert(venues)
        .values({ slug: `amp-${tag}`, name: "AMP test", address: "1 A St", city: "Rogers", lat: 36.3, lng: -94.18, venueType: "music_venue" })
        .returning();
      const link = await linkTicketmasterVenue(tx, {
        sourceId: s.id,
        tmVenueId: "V1",
        venueSlug: v.slug,
        actor: humanActor("owner"),
        reason: "Owner approved the coverage report",
      });
      expect(link).toMatchObject({ venueId: v.id, externalId: "V1" });
      const [a] = await tx.select().from(agentActions).where(eq(agentActions.entityId, link.id));
      expect(a).toMatchObject({ action: "insert", entityType: "venue_external_id", actor: "human:owner" });
      await expect(
        linkTicketmasterVenue(tx, { sourceId: s.id, tmVenueId: "V1", venueSlug: v.slug, actor: humanActor("owner"), reason: "again, twice" }),
      ).rejects.toThrow(/already linked/);
      expect(await tx.select().from(venueExternalIds).where(eq(venueExternalIds.sourceId, s.id))).toHaveLength(1);
    });
  });
});
