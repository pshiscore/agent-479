import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { agentActor, humanActor } from "@/lib/actions/record";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, rawRecords, sources, venueExternalIds, venues } from "@/lib/db/schema";
import { storeItems } from "@/lib/pipeline/fetch";
import { purgeStalePayloads } from "@/lib/pipeline/maintenance";
import { startRun } from "@/lib/runs";
import {
  approveLinkProposal,
  linkTicketmasterVenue,
  proposeTicketmasterLinks,
  rejectLinkProposal,
  ticketmasterVenuesInRawRecords,
} from "@/lib/sources/ticketmaster-venues";
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

describe("Ticketmaster link proposals", () => {
  // Uses the real ticketmaster source row (inside a rolled-back transaction).
  async function setup(tx: DbTx) {
    const [tm] = await tx.select().from(sources).where(eq(sources.slug, "ticketmaster"));
    const run = await startRun(tx, "fetch", { sourceId: tm.id });
    const [venue] = await tx
      .insert(venues)
      .values({ slug: `hall-${tag}`, name: `Glimmer Hall ${tag}`, address: "10 Test St", city: "Rogers", lat: 36.31, lng: -94.2, venueType: "music_venue" })
      .returning();
    const tmItem = (id: string, venueId: string, name: string, lat: number, lng: number, address = `${id} Elsewhere Ave`): FetchedItem => ({
      externalId: `${id}-${tag}`,
      sourceUrl: null,
      payload: { format: "ticketmaster", event: { id, venues: [{ id: venueId, name, address, city: "Rogers", lat, lng }] } },
      descriptionText: null,
      descriptionPurgeAfter: null,
    });
    return { tm, run, venue, tmItem };
  }
  const mine = (tx: DbTx) =>
    tx
      .select()
      .from(agentActions)
      .where(and(eq(agentActions.action, "propose_link"), eq(agentActions.entityType, "venue_external_id")))
      .then((rows) => rows.filter((r) => (r.dedupeKey ?? "").includes(tag)));

  it("proposes only close names within 150 m, never links, and doesn't repeat itself", async () => {
    await inRollback(async (tx) => {
      const { tm, run, venue, tmItem } = await setup(tx);
      await storeItems(tx, tm, run.id, [
        tmItem("E1", `NEAR-${tag}`, `Glimmer Hall ${tag}`, 36.3105, -94.2005), // ~70 m, same name: proposed
        tmItem("E2", `FAR-${tag}`, `Glimmer Hall ${tag}`, 36.32, -94.2), // ~1.1 km: not proposed
        tmItem("E3", `OTHER-${tag}`, "Completely Different Club", 36.3101, -94.2001), // close but another name
      ], new Date());

      await proposeTicketmasterLinks(tx, { actor: agentActor("maintenance") });
      const proposals = await mine(tx);
      expect(proposals.map((p) => (p.after as { tmVenueId: string }).tmVenueId)).toEqual([`NEAR-${tag}`]);
      expect(proposals[0]).toMatchObject({ approvalStatus: "pending", entityId: null });
      expect(await tx.select().from(venueExternalIds).where(eq(venueExternalIds.venueId, venue.id))).toEqual([]);

      await proposeTicketmasterLinks(tx, { actor: agentActor("maintenance") });
      expect(await mine(tx)).toHaveLength(1);
    });
  });

  it("proposes by street address (path b) when the point is a placeholder", async () => {
    await inRollback(async (tx) => {
      const { tm, run, tmItem } = await setup(tx);
      await storeItems(tx, tm, run.id, [
        tmItem("Q1", `ADDR-${tag}`, `Glimmer Hall ${tag}`, 35.99, -94.08, "10 Test Street"),
        tmItem("Q2", `ADDR2-${tag}`, "Unrelated Venue", 35.99, -94.08, "99 Other Rd"),
      ], new Date());
      await proposeTicketmasterLinks(tx, { actor: agentActor("maintenance") });
      const proposals = await mine(tx);
      expect(proposals.map((p) => (p.after as { tmVenueId: string; path: string }))).toEqual([
        expect.objectContaining({ tmVenueId: `ADDR-${tag}`, path: "address", distanceM: null }),
      ]);
    });
  });

  it("ignores placeholder points shared by several venues", async () => {
    await inRollback(async (tx) => {
      const { tm, run, tmItem } = await setup(tx);
      // Three venues share one point next to our hall: a placeholder, so no proposal.
      await storeItems(tx, tm, run.id, [
        tmItem("P1", `PH1-${tag}`, `Glimmer Hall ${tag}`, 36.3101, -94.2001),
        tmItem("P2", `PH2-${tag}`, "Other A", 36.3101, -94.2001),
        tmItem("P3", `PH3-${tag}`, "Other B", 36.3101, -94.2001),
      ], new Date());
      await proposeTicketmasterLinks(tx, { actor: agentActor("maintenance") });
      expect(await mine(tx)).toEqual([]);
    });
  });

  it("links on approval (logged), keeps rejections rejected, and allows several TM IDs per venue", async () => {
    await inRollback(async (tx) => {
      const { tm, run, venue, tmItem } = await setup(tx);
      await storeItems(tx, tm, run.id, [
        tmItem("A1", `DUP1-${tag}`, `Glimmer Hall ${tag}`, 36.3105, -94.2005),
        tmItem("A2", `DUP2-${tag}`, `Glimmer Hall ${tag}`, 36.3104, -94.2004),
      ], new Date());
      await proposeTicketmasterLinks(tx, { actor: agentActor("maintenance") });
      const [p1, p2] = (await mine(tx)).sort((a, b) => (a.dedupeKey! < b.dedupeKey! ? -1 : 1));

      await expect(approveLinkProposal(tx, p1.id, agentActor("maintenance"), "machine approval")).rejects.toThrow(/only a person/);
      await approveLinkProposal(tx, p1.id, humanActor("owner"), "Same building, checked the report");
      await rejectLinkProposal(tx, p2.id, humanActor("owner"), "Not sure yet, leave it out");

      const links = await tx.select().from(venueExternalIds).where(eq(venueExternalIds.venueId, venue.id));
      expect(links.map((l) => l.externalId)).toEqual([`DUP1-${tag}`]);
      expect(links[0].subSpace).toBeNull();
      // A second Ticketmaster ID for the same venue is fine.
      await linkTicketmasterVenue(tx, { sourceId: tm.id, tmVenueId: `DUP3-${tag}`, venueSlug: venue.slug, actor: humanActor("owner"), reason: "duplicate TM record" });
      expect(await tx.select().from(venueExternalIds).where(eq(venueExternalIds.venueId, venue.id))).toHaveLength(2);

      const decided = await mine(tx);
      expect(decided.map((p) => p.approvalStatus).sort()).toEqual(["approved", "rejected"]);
      // Neither is proposed again.
      await proposeTicketmasterLinks(tx, { actor: agentActor("maintenance") });
      expect((await mine(tx)).filter((p) => p.approvalStatus === "pending")).toEqual([]);
    });
  });
});
