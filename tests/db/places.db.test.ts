import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { agentActor, humanActor } from "@/lib/actions/record";
import { confirmSource, createPlace, hidePlace, linkVenue, PlaceError, publishPlace, suggestVenues } from "@/lib/admin/places";
import { getDb } from "@/lib/db/client";
import { agentActions, places } from "@/lib/db/schema";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const OWNER = humanActor("owner");
const tag = randomUUID().slice(0, 6);
const base = { name: `Test Bakery ${tag}`, placeType: "bakery" as const, kind: "new" as const, address: "1 Test St", city: "Rogers" };

describe("places", () => {
  it("publishes only when open to the public, with a stated date and an owner-verified source; every step logged", async () => {
    await inRollback(async (tx) => {
      const draft = await createPlace(tx, { ...base, opened: "2026-08-10", sourceUrl: "https://news.example/a" }, { actor: agentActor("research"), ownerVerified: false, reason: "lead" });
      expect(draft).toMatchObject({ status: "draft", openedOn: "2026-08-10", openedPrecision: "day", category: "restaurants", sources: [{ url: "https://news.example/a", note: "lead" }] });
      await expect(publishPlace(tx, draft.id, { actor: OWNER, note: "go" })).rejects.toThrow(/open to the public.*owner-verified source/);

      await confirmSource(tx, draft.id, { actor: OWNER, url: "https://news.example/a", confirmed: "Article says it opened Aug 10, 2026", openToPublic: true });
      const live = await publishPlace(tx, draft.id, { actor: OWNER, note: "checked" });
      expect(live).toMatchObject({ status: "open", openToPublic: true });
      expect(live.sources).toEqual([expect.objectContaining({ url: "https://news.example/a", verifiedBy: "owner" })]);

      const log = await tx.select().from(agentActions).where(and(eq(agentActions.entityType, "place"), eq(agentActions.entityId, draft.id)));
      expect(log.map((l) => l.action).sort()).toEqual(["insert", "publish", "update"]);
      await expect(publishPlace(tx, draft.id, { actor: agentActor("x"), note: "auto" })).rejects.toBeInstanceOf(PlaceError);
    });
  });

  it("never publishes without a stated date; a target date publishes as opening soon", async () => {
    await inRollback(async (tx) => {
      const nodate = await createPlace(tx, { ...base, sourceUrl: "https://x.example/1", openToPublic: true }, { actor: OWNER, ownerVerified: true, reason: "owner" });
      await expect(publishPlace(tx, nodate.id, { actor: OWNER, note: "go" })).rejects.toThrow(/no stated opening date/);
      const soon = await createPlace(tx, { ...base, name: `${base.name} 2`, target: "2026-11", sourceUrl: "https://x.example/2", openToPublic: true }, { actor: OWNER, ownerVerified: true, reason: "owner" });
      expect((await publishPlace(tx, soon.id, { actor: OWNER, note: "go" })).status).toBe("opening_soon");
    });
  });

  it("the database refuses a public place that isn't open to the public", async () => {
    await inRollback(async (tx) => {
      const p = await createPlace(tx, { ...base, opened: "2026-08-10", sourceUrl: "https://x.example/3" }, { actor: OWNER, ownerVerified: true, reason: "owner" });
      await expect(tx.update(places).set({ status: "open", publishedAt: new Date() }).where(eq(places.id, p.id))).rejects.toThrow();
    });
  });

  it("saves food trucks as a home base and flags intersections; hides with a reason", async () => {
    await inRollback(async (tx) => {
      const truck = await createPlace(tx, { ...base, name: `Truck ${tag}`, placeType: "food_truck", address: "Railyard Park" }, { actor: OWNER, ownerVerified: true, reason: "owner" });
      expect(truck.addressKind).toBe("home_base");
      const corner = await createPlace(tx, { ...base, name: `Corner ${tag}`, address: "A St at B St", addressKind: "intersection" }, { actor: OWNER, ownerVerified: true, reason: "owner" });
      expect(corner.streetNumberUnconfirmed).toBe(true);
      const hidden = await hidePlace(tx, corner.id, { actor: OWNER, reason: "closed again" });
      expect(hidden).toMatchObject({ status: "hidden", hiddenReason: "closed again" });
    });
  });

  it("suggests a venue by address or name and links only when the owner confirms", async () => {
    await inRollback(async (tx) => {
      const p = await createPlace(tx, { ...base, name: `Museum Cafe ${tag}`, address: "313 S 2nd St" }, { actor: OWNER, ownerVerified: true, reason: "owner" });
      const s = await suggestVenues(tx, p);
      const museum = s.find((m) => m.venue.slug === "rogers-historical-museum");
      expect(museum).toMatchObject({ byAddress: true });
      expect((await tx.select().from(places).where(eq(places.id, p.id)))[0].venueId).toBeNull();
      expect((await linkVenue(tx, p.id, museum!.venue.id, { actor: OWNER, reason: "same building" })).venueId).toBe(museum!.venue.id);
    });
  });
});
