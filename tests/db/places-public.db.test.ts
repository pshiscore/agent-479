import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { humanActor } from "@/lib/actions/record";
import { createPlace, hidePlace, publishPlace } from "@/lib/admin/places";
import { getDb } from "@/lib/db/client";
import { openingSoon, placeBySlug, recentOpenings } from "@/lib/places/public";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const OWNER = humanActor("owner");
const tag = randomUUID().slice(0, 6);
const NOW = new Date("2026-10-05T17:00:00Z"); // window starts 2026-04-01

describe("New in Town public reads", () => {
  it("shows only published places: opened in the window newest first, opening soon apart, drafts and hidden never", async () => {
    await inRollback(async (tx) => {
      const add = (name: string, extra: object) =>
        createPlace(tx, { name: `${name} ${tag}`, placeType: "cafe", kind: "new", address: "1 Test St", city: "Rogers", sourceUrl: `https://x.example/${name}`, openToPublic: true, ...extra }, { actor: OWNER, ownerVerified: true, reason: "test" });
      const publish = async (name: string, extra: object) => {
        const p = await add(name, extra);
        return publishPlace(tx, p.id, { actor: OWNER, note: "test", now: NOW });
      };
      const aug = await publish("aug", { opened: "2026-08-18" });
      const june = await publish("june", { opened: "2026-06" });
      const april = await publish("april", { opened: "2026-04-01" });
      await publish("march", { opened: "2026-03-31" }); // before the window
      const soon = await publish("soon", { target: "2026-11" });
      const draft = await add("draft", { opened: "2026-09-01" });
      const gone = await publish("gone", { opened: "2026-09-02" });
      await hidePlace(tx, gone.id, { actor: OWNER, reason: "closed" });

      const mine = (rows: { name: string }[]) => rows.map((r) => r.name).filter((n) => n.endsWith(tag));
      expect(mine(await recentOpenings(tx, NOW))).toEqual([aug.name, june.name, april.name]);
      expect(mine(await recentOpenings(tx, NOW, { category: "restaurants" }))).toEqual([aug.name, june.name, april.name]);
      expect(mine(await recentOpenings(tx, NOW, { category: "shops" }))).toEqual([]);
      expect(mine(await openingSoon(tx))).toEqual([soon.name]);

      expect(await placeBySlug(tx, aug.slug)).toMatchObject({ name: aug.name });
      expect(await placeBySlug(tx, soon.slug)).toMatchObject({ status: "opening_soon" });
      expect(await placeBySlug(tx, draft.slug)).toBeNull();
      expect(await placeBySlug(tx, gone.slug)).toBeNull();
    });
  });
});
