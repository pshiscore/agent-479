import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { humanActor } from "@/lib/actions/record";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, venueExternalIds, venues } from "@/lib/db/schema";
import { startRun } from "@/lib/runs";
import { SeedRefusedError, seedVenues } from "@/lib/venues/seed";
import { type SeedFile, seedVenueSchema, venuesHash } from "@/lib/venues/seed-file";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

// Unique per test run so rows can't collide with real or leftover data.
const tag = randomUUID().slice(0, 8);
const prov = { url: "https://example.org/visit", checkedAt: "2026-10-02" };
const TODAY = new Date("2026-10-03T12:00:00Z");

const baseVenue = {
  name: `Test Hall ${tag}`,
  address: "1 Test St",
  city: "Rogers",
  lat: 36.332,
  lng: -94.118,
  venueType: "theater" as const,
};

/** Runs `query` in a savepoint and returns the Postgres error, if any. */
async function pgError(tx: DbTx, query: (tx: DbTx) => Promise<unknown>): Promise<string | undefined> {
  try {
    await tx.transaction(async (sp) => {
      await query(sp);
    });
    return undefined;
  } catch (err) {
    const cause = (err as { cause?: { constraint_name?: string; message?: string } }).cause;
    return cause?.constraint_name ?? cause?.message ?? String(err);
  }
}

describe("venues table", () => {
  it("enforces address, slug, and parent rules", async () => {
    await inRollback(async (tx) => {
      const insert = (v: Partial<typeof venues.$inferInsert>) => (sp: DbTx) =>
        sp.insert(venues).values({ ...baseVenue, slug: `t-${tag}`, ...v });

      expect(await pgError(tx, insert({ address: null }))).toBe("venues_address_check");
      expect(await pgError(tx, insert({ address: null, venueType: "area" }))).toBeUndefined();
      expect(await pgError(tx, insert({ slug: "Bad Slug" }))).toBe("venues_slug_check");
      expect(await pgError(tx, insert({ venueType: "stadium" as "arena" }))).toBe("venues_type_check");

      const [v] = await tx.insert(venues).values({ ...baseVenue, slug: `p-${tag}` }).returning();
      expect(
        await pgError(tx, (sp) => sp.update(venues).set({ parentVenueId: v.id }).where(eq(venues.id, v.id))),
      ).toBe("venues_parent_check");
      expect(await pgError(tx, insert({ slug: `p-${tag}` }))).toBe("venues_slug_uniq");
    });
  });

  it("stores coordinates at 6 decimal places", async () => {
    await inRollback(async (tx) => {
      const [v] = await tx
        .insert(venues)
        .values({ ...baseVenue, slug: `c-${tag}`, lat: 36.3320004, lng: -94.1180006 })
        .returning();
      expect([v.lat, v.lng]).toEqual([36.332, -94.118001]);
    });
  });

  it("supports trigram name lookup and alias lookup", async () => {
    await inRollback(async (tx) => {
      await tx
        .insert(venues)
        .values({ ...baseVenue, slug: `g-${tag}`, name: `Gloria Test Theatre ${tag}`, aliases: [`GTT-${tag}`] });

      const [fuzzy] = await tx
        .select({ slug: venues.slug, score: sql<number>`similarity(${venues.name}, ${`gloria test theater ${tag}`})` })
        .from(venues)
        .where(sql`${venues.name} % ${`gloria test theater ${tag}`}`);
      expect(fuzzy.slug).toBe(`g-${tag}`);
      expect(fuzzy.score).toBeGreaterThan(0.5);

      const byAlias = await tx
        .select({ slug: venues.slug })
        .from(venues)
        .where(sql`${venues.aliases} @> array[${`GTT-${tag}`}]::text[]`);
      expect(byAlias).toEqual([{ slug: `g-${tag}` }]);
    });
  });

  it("keeps external IDs unique per source and cascades on venue delete", async () => {
    await inRollback(async (tx) => {
      const [v] = await tx.insert(venues).values({ ...baseVenue, slug: `x-${tag}` }).returning();
      const sourceId = randomUUID();
      await tx.insert(venueExternalIds).values({ venueId: v.id, sourceId, externalId: "KovZpZA7AAEA" });
      expect(
        await pgError(tx, (sp) =>
          sp.insert(venueExternalIds).values({ venueId: v.id, sourceId, externalId: "KovZpZA7AAEA" }),
        ),
      ).toBe("venue_external_ids_source_external_uniq");

      await tx.delete(venues).where(eq(venues.id, v.id));
      expect(await tx.select().from(venueExternalIds).where(eq(venueExternalIds.venueId, v.id))).toEqual([]);
    });
  });
});

describe("seedVenues", () => {
  const parent = seedVenueSchema.parse({
    slug: `campus-${tag}`,
    name: `Test Campus ${tag}`,
    venueType: "campus",
    address: "100 Campus Dr",
    city: "Fayetteville",
    lat: 36.068,
    lng: -94.174,
    verification: { name: prov, address: prov, location: prov },
  });
  const child = seedVenueSchema.parse({
    slug: `hall-${tag}`,
    name: `Test Recital Hall ${tag}`,
    aliases: [`TRH ${tag}`],
    venueType: "theater",
    address: "110 Campus Dr",
    city: "Fayetteville",
    lat: 36.0682,
    lng: -94.1741,
    parent: parent.slug,
    verification: { name: prov, address: prov, location: prov },
  });
  // Child listed first: the seeder must insert the parent before it.
  const list = [child, parent];
  const signed = (vs = list): SeedFile => ({
    reviewed: { by: "test", at: "2026-10-03", sha256: venuesHash(vs) },
    venues: vs,
  });
  const actor = humanActor("seed-venues-test");

  it("refuses an unsigned or changed file", async () => {
    await inRollback(async (tx) => {
      const run = await startRun(tx, "seed");
      const opts = { runId: run.id, actor, today: TODAY };
      await expect(seedVenues(tx, { reviewed: null, venues: list }, opts)).rejects.toThrow(/no sign-off/);
      const stale = { ...signed(), venues: [child, { ...parent, lat: 36.069 }] };
      await expect(seedVenues(tx, stale, opts)).rejects.toThrow(SeedRefusedError);
      await expect(seedVenues(tx, stale, opts)).rejects.toThrow(/changed since sign-off/);
    });
  });

  it("inserts parents first, logs each insert, and is idempotent", async () => {
    await inRollback(async (tx) => {
      const run = await startRun(tx, "seed");
      const opts = { runId: run.id, actor, today: TODAY };

      const first = await seedVenues(tx, signed(), opts);
      expect(first).toMatchObject({ inserted: 2, updated: 0, unchanged: 0 });

      const [p] = await tx.select().from(venues).where(eq(venues.slug, parent.slug));
      const [c] = await tx.select().from(venues).where(eq(venues.slug, child.slug));
      expect(c.parentVenueId).toBe(p.id);
      expect(c.verification).toMatchObject({ name: prov, reviewed: { by: "test" } });

      const logged = await tx
        .select()
        .from(agentActions)
        .where(and(eq(agentActions.runId, run.id), eq(agentActions.entityType, "venue")));
      expect(logged.map((a) => a.action)).toEqual(["insert", "insert"]);

      const again = await seedVenues(tx, signed(), opts);
      expect(again).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    });
  });

  it("updates only changed venues, with before and after", async () => {
    await inRollback(async (tx) => {
      const run = await startRun(tx, "seed");
      const opts = { runId: run.id, actor, today: TODAY };
      await seedVenues(tx, signed(), opts);

      const renamed = [{ ...child, name: `Test Recital Hall Renamed ${tag}` }, parent];
      const result = await seedVenues(tx, signed(renamed), opts);
      expect(result).toMatchObject({ inserted: 0, updated: 2, unchanged: 0 });
      // Both rows record the new sign-off; only the child's name changed.
      const updates = await tx
        .select()
        .from(agentActions)
        .where(and(eq(agentActions.runId, run.id), eq(agentActions.action, "update")));
      const childUpdate = updates.find((u) => u.reason.includes(child.slug));
      expect(childUpdate?.reason).toMatch(/name, verification/);
      expect((childUpdate?.before as { name: string }).name).toBe(child.name);
      expect((childUpdate?.after as { name: string }).name).toBe(`Test Recital Hall Renamed ${tag}`);
    });
  });
});
