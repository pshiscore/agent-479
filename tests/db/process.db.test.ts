import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { agentActor } from "@/lib/actions/record";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, rawRecords, sources, venues } from "@/lib/db/schema";
import { type Facts, mapRecord } from "@/lib/pipeline/map";
import { processRecord } from "@/lib/pipeline/process";
import { proposeVenues } from "@/lib/pipeline/venue-proposals";
import { resolveVenue } from "@/lib/pipeline/venue-resolve";
import { startRun } from "@/lib/runs";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const tag = randomUUID().slice(0, 8);
const NOW = new Date("2026-10-04T15:00:00Z");

const icsPayload = (over: Record<string, unknown> = {}) => ({
  format: "ics",
  feed: { url: "https://x.example/f.ics", defaultTimezone: "America/Chicago", timezones: ["America/Chicago"] },
  event: {
    uid: "9001",
    recurrenceId: null,
    summary: "Ghost Walks",
    dtstart: { value: "20261028T190000", tzid: "America/Chicago", isDate: false },
    dtend: null,
    duration: null,
    rrule: null,
    rdate: [],
    exdate: [],
    location: "<p>Rogers Historical Museum</p> - 313 S 2nd St  Rogers AR 72756",
    geo: null,
    url: null,
    status: "CONFIRMED",
    categories: [],
    sequence: null,
    lastModified: null,
    ...over,
  },
});
const SRC = { baseUrl: "https://x.example/", config: {} };
const factsFor = (over: Record<string, unknown>) => mapRecord(icsPayload(over), SRC);

async function slugId(tx: DbTx, slug: string) {
  const [v] = await tx.select({ id: venues.id }).from(venues).where(eq(venues.slug, slug));
  return v.id;
}

describe("resolveVenue (against the seeded venues)", () => {
  it("resolves by alias, stripping the HTML around the name", async () => {
    await inRollback(async (tx) => {
      const r = await resolveVenue(tx, factsFor({}), { id: randomUUID(), defaultVenueId: null });
      expect(r).toEqual({ venueId: await slugId(tx, "rogers-historical-museum"), subSpace: null, matchedBy: "alias" });
    });
  });

  it("uses the default venue with the room as sub-space, but not for the bookmobile", async () => {
    await inRollback(async (tx) => {
      const lib = await slugId(tx, "fayetteville-public-library");
      const room = factsFor({ location: "Fayetteville Public Library - Walmart Story Time Room (1st Floor)" });
      expect(await resolveVenue(tx, room, { id: randomUUID(), defaultVenueId: lib })).toEqual({
        venueId: lib,
        subSpace: "Walmart Story Time Room (1st Floor)",
        matchedBy: "default_venue",
      });
      const bookmobile = factsFor({ location: "FPL on Wheels Bookmobile -" });
      expect(await resolveVenue(tx, bookmobile, { id: randomUUID(), defaultVenueId: lib })).toBeNull();
    });
  });

  it("resolves by external ID with the link's sub-space (Ticketmaster)", async () => {
    await inRollback(async (tx) => {
      const [tm] = await tx.select().from(sources).where(eq(sources.slug, "ticketmaster"));
      const facts: Facts = { ...factsFor({}), location: { text: "x", name: "Walton Arts Center - Baum Walker Hall", room: null, street: null, city: "Fayetteville", externalVenueId: "ZFr9jZkF6d" } };
      expect(await resolveVenue(tx, facts, { id: tm.id, defaultVenueId: null })).toEqual({
        venueId: await slugId(tx, "walton-arts-center"),
        subSpace: "Baum Walker Hall",
        matchedBy: "external_id",
      });
    });
  });

  it("resolves by street address in the same city when the name differs", async () => {
    await inRollback(async (tx) => {
      const f = factsFor({ location: "Museum Annex - 313 S 2nd St  Rogers AR 72756" });
      expect(await resolveVenue(tx, f, { id: randomUUID(), defaultVenueId: null })).toMatchObject({
        venueId: await slugId(tx, "rogers-historical-museum"),
        matchedBy: "address",
      });
    });
  });

  it("prefers the building at the address over an area alias (Blood Drive at 15 W Mountain)", async () => {
    await inRollback(async (tx) => {
      const f = factsFor({ location: "Fayetteville Square - 15 W Mountain  Fayetteville AR 72701" });
      expect(await resolveVenue(tx, f, { id: randomUUID(), defaultVenueId: null })).toEqual({
        venueId: await slugId(tx, "fayetteville-town-center"),
        subSpace: null,
        matchedBy: "address",
      });
    });
  });

  it("takes a room named after the venue as its sub-space (Key Wing)", async () => {
    await inRollback(async (tx) => {
      const f = factsFor({ location: "Rogers Historical Museum: Key Wing Education Center - 313 S 2nd St  Rogers AR 72756" });
      expect(await resolveVenue(tx, f, { id: randomUUID(), defaultVenueId: null })).toEqual({
        venueId: await slugId(tx, "rogers-historical-museum"),
        subSpace: "Key Wing Education Center",
        matchedBy: "address",
      });
    });
  });

  it("asks the LLM only among plausible candidates, and accepts only a candidate", async () => {
    await inRollback(async (tx) => {
      await tx.insert(venues).values({ slug: `glimmer-${tag}`, name: "Glimmer Hall", address: "1 A St", city: "Rogers", lat: 36.3, lng: -94.1, venueType: "other" });
      // Trigram similarity 0.36: plausible enough to ask, too low to accept unasked.
      const f = factsFor({ location: "The Glimmer Room - 9 Z St  Rogers AR 72756" });
      const pick = vi.fn(async ({ candidates }: { candidates: { slug: string }[] }) => candidates.find((c) => c.slug === `glimmer-${tag}`)?.slug ?? null);
      const r = await resolveVenue(tx, f, { id: randomUUID(), defaultVenueId: null }, { llmPick: pick });
      expect(pick).toHaveBeenCalledTimes(1);
      expect(r).toMatchObject({ matchedBy: "llm" });
      const bogus = vi.fn(async () => "walton-arts-center"); // not a Rogers candidate
      expect(await resolveVenue(tx, f, { id: randomUUID(), defaultVenueId: null }, { llmPick: bogus })).toBeNull();
    });
  });
});

describe("processRecord", () => {
  async function addRecord(tx: DbTx, payload: Record<string, unknown>) {
    const [src] = await tx
      .insert(sources)
      .values({ slug: `proc-${tag}-${randomUUID().slice(0, 4)}`, name: "P", kind: "ics", fetcher: "ics", baseUrl: "https://x.example/", trustLevel: 3, fetchIntervalMinutes: 60, termsNotes: "t" })
      .returning();
    const run = await startRun(tx, "fetch", { sourceId: src.id });
    const [rec] = await tx
      .insert(rawRecords)
      .values({ sourceId: src.id, runId: run.id, externalId: randomUUID(), contentHash: "h", payload })
      .returning();
    return { src, rec };
  }

  it("maps, skips, fails, and parks unmatched records in needs_venue", async () => {
    await inRollback(async (tx) => {
      const cases: [Record<string, unknown>, string, string][] = [
        [{}, "mapped", "alias"],
        [{ summary: "City Council Meeting" }, "skipped", "government_meeting"],
        [{ dtstart: null }, "failed", "event has no start"],
        [{ location: "Unheard Of Place - 1 Nowhere Rd  Rogers AR 72756" }, "needs_venue", "Unheard Of Place - 1 Nowhere Rd Rogers AR 72756"],
      ];
      for (const [over, outcome, detail] of cases) {
        const { src, rec } = await addRecord(tx, icsPayload(over));
        const r = await processRecord(tx, rec, src, { now: NOW });
        expect(r.outcome).toBe(outcome);
        expect(r.detail).toContain(detail);
        const [after] = await tx.select().from(rawRecords).where(eq(rawRecords.id, rec.id));
        expect(after.status).toBe(outcome);
        expect(after.attempts).toBe(1);
        if (outcome === "needs_venue") expect(after.locationKey).toBe("unheard of place | 1 nowhere rd | rogers");
      }
    });
  });
});

describe("proposeVenues", () => {
  it("proposes a location seen on 2+ unmatched records, but never a bare city", async () => {
    await inRollback(async (tx) => {
      const [src] = await tx.select().from(sources).where(eq(sources.slug, "city-rogers"));
      const run = await startRun(tx, "process");
      const rec = (key: string, text: string) => ({
        sourceId: src.id,
        runId: run.id,
        externalId: randomUUID(),
        contentHash: "h",
        payload: {},
        status: "needs_venue" as const,
        locationKey: key,
        facts: { title: `T ${randomUUID().slice(0, 4)}`, location: { text } },
      });
      const key = `new place ${tag} | 5 elm st | rogers`;
      await tx.insert(rawRecords).values([rec(key, "New Place - 5 Elm St"), rec(key, "New Place - 5 Elm St"), rec(`nolocation:rogers${tag}`, "Rogers AR"), rec(`nolocation:rogers${tag}`, "Rogers AR")]);
      await proposeVenues(tx, { actor: agentActor("process"), runId: run.id });
      const mine = await tx.select().from(agentActions).where(and(eq(agentActions.action, "propose_venue")));
      const keys = mine.map((m) => m.dedupeKey);
      expect(keys).toContain(`venue:${key}`);
      expect(keys).not.toContain(`venue:nolocation:rogers${tag}`);
      expect(mine.find((m) => m.dedupeKey === `venue:${key}`)).toMatchObject({ approvalStatus: "pending", entityId: null });
    });
  });
});
