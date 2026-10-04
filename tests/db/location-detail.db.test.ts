import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { agentActor } from "@/lib/actions/record";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, llmCalls, rawRecords, sources, venues } from "@/lib/db/schema";
import { FetchBlockedError } from "@/lib/http/fetch";
import type { GenerateRequest } from "@/lib/llm";
import type { Generate } from "@/lib/pipeline/enrich/types";
import { checkVagueLocation, vagueRecordsDue } from "@/lib/pipeline/location-detail";
import type { PoliteClient } from "@/lib/sources/http";
import { startRun } from "@/lib/runs";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const NOW = new Date("2026-10-04T15:00:00Z");
const ACTOR = agentActor("process");

// Written for this test in the shape of a CivicPlus detail page; not source text.
const page = (name: string, street = "", description = "") => `
<div itemprop="location" itemscope itemtype="http://schema.org/Place">
  <div itemprop="name"> ${name} </div>
  <span itemprop="address" itemscope itemtype="http://schema.org/PostalAddress">
    <span itemprop="streetAddress">${street}</span> <span itemprop="addressLocality">Rogers</span></span>
</div>
<div itemprop="description" class="fr-view">${description}</div><ul itemprop="documents"></ul>`;

const fakeHttp = (html: string | Error) => {
  const get = vi.fn(async (url: string) => {
    if (html instanceof Error) throw html;
    return { url, status: 200, contentType: "text/html", text: html };
  });
  return { http: { get } as unknown as PoliteClient, get };
};

function fakeModel(tx: DbTx, place: { name: string | null; street: string | null; city: string | null }) {
  return vi.fn(async (req: GenerateRequest<z.ZodType>) => {
    const [call] = await tx.insert(llmCalls).values({ task: req.task, provider: "fake", model: "fake-model", status: "ok", promptVersion: req.promptVersion }).returning({ id: llmCalls.id });
    return { data: req.schema.parse(place), callId: call.id, model: "fake-model", costUsd: 0 };
  }) as unknown as Generate;
}
const noPlace = { name: null, street: null, city: null };

async function vagueRecord(tx: DbTx, over: { name?: string | null; sourceUrl?: string } = {}) {
  const [src] = await tx.select().from(sources).where(eq(sources.slug, "city-rogers"));
  const run = await startRun(tx, "process");
  const facts = {
    title: "Fall Festival", startAt: "2026-10-20T23:00:00.000Z", endAt: null, allDay: false, timeTba: false, status: "scheduled",
    sourceUrl: over.sourceUrl ?? "https://www.rogersar.gov/Calendar.aspx?EID=1",
    ticketUrl: null,
    location: { text: "- Rogers AR 72756", name: over.name ?? null, room: null, street: null, city: "Rogers", externalVenueId: null },
    price: { min: null, max: null, currency: null }, performers: [], sourceCategories: [], legalAgeEnforced: null, recurrence: null, timezoneAssumed: false,
  };
  const [rec] = await tx
    .insert(rawRecords)
    .values({ sourceId: src.id, runId: run.id, externalId: randomUUID(), contentHash: "h", payload: {}, status: "needs_venue", facts, locationKey: "nolocation:rogers" })
    .returning();
  return { rec, src: { ...src, enabled: true }, run };
}

describe("checkVagueLocation", () => {
  it("finds the Place on the detail page and proposes a match to our venue, never applying it", async () => {
    await inRollback(async (tx) => {
      const { rec, src, run } = await vagueRecord(tx);
      expect((await vagueRecordsDue(tx, NOW, 100)).map((r) => r.record.id)).toContain(rec.id);
      const { http, get } = fakeHttp(page("Rogers Historical Museum", "313 S 2nd St"));
      const r = await checkVagueLocation(tx, rec, src, { http, generate: fakeModel(tx, noPlace), actor: ACTOR, runId: run.id, now: NOW });
      expect(r.outcome).toBe("found_match");
      expect(get).toHaveBeenCalledWith("https://www.rogersar.gov/Calendar.aspx?EID=1", "text/html");
      const [museum] = await tx.select().from(venues).where(eq(venues.slug, "rogers-historical-museum"));
      const [p] = await tx.select().from(agentActions).where(and(eq(agentActions.action, "propose_venue_match"), eq(agentActions.dedupeKey, `match:${rec.id}:${museum.id}`)));
      expect(p).toMatchObject({ approvalStatus: "pending", entityType: "raw_record" });
      expect(p.after).toMatchObject({ rawRecordId: rec.id, venueId: museum.id, foundIn: "detail_page_place" });
      const [after] = await tx.select().from(rawRecords).where(eq(rawRecords.id, rec.id));
      expect(after).toMatchObject({ status: "needs_venue", venueId: null, locationCheckedAt: NOW });
      // Checked this week: not due again.
      expect((await vagueRecordsDue(tx, NOW, 100)).map((x) => x.record.id)).not.toContain(rec.id);
    });
  });

  it("reads prose in the location field first, without fetching when it names a place", async () => {
    await inRollback(async (tx) => {
      const { rec, src, run } = await vagueRecord(tx, { name: "The city invites everyone to the fall festival. It takes place at the Rogers Historical Museum this year." });
      const { http, get } = fakeHttp(page("Event Location"));
      const generate = fakeModel(tx, { name: "Rogers Historical Museum", street: null, city: "Rogers" });
      const r = await checkVagueLocation(tx, rec, src, { http, generate, actor: ACTOR, runId: run.id, now: NOW });
      expect(r.outcome).toBe("found_match");
      expect(get).not.toHaveBeenCalled();
    });
  });

  it("proposes a new venue for a place we don't have, and records a plain miss", async () => {
    await inRollback(async (tx) => {
      const a = await vagueRecord(tx);
      const found = await checkVagueLocation(tx, a.rec, a.src, { http: fakeHttp(page("Glimmerfield Pavilion", "9 Nowhere Rd")).http, generate: fakeModel(tx, noPlace), actor: ACTOR, runId: a.run.id, now: NOW });
      expect(found.outcome).toBe("found_new");
      const [p] = await tx.select().from(agentActions).where(eq(agentActions.dedupeKey, "venue:glimmerfield pavilion | 9 nowhere rd | rogers"));
      expect(p).toMatchObject({ action: "propose_venue", approvalStatus: "pending" });

      const b = await vagueRecord(tx);
      const miss = await checkVagueLocation(tx, b.rec, b.src, { http: fakeHttp(page("Event Location")).http, generate: fakeModel(tx, noPlace), actor: ACTOR, runId: b.run.id, now: NOW });
      expect(miss.outcome).toBe("not_found");
    });
  });

  it("never fetches off the source's domain, and a block disables the source", async () => {
    await inRollback(async (tx) => {
      const off = await vagueRecord(tx, { sourceUrl: "https://elsewhere.example/event/1" });
      const { http, get } = fakeHttp(page("Rogers Historical Museum", "313 S 2nd St"));
      expect((await checkVagueLocation(tx, off.rec, off.src, { http, generate: fakeModel(tx, noPlace), actor: ACTOR, runId: off.run.id, now: NOW })).outcome).toBe("skipped");
      expect(get).not.toHaveBeenCalled();

      const blocked = await vagueRecord(tx);
      await tx.update(sources).set({ enabled: true, disabledReason: null }).where(eq(sources.id, blocked.src.id));
      const r = await checkVagueLocation(tx, blocked.rec, blocked.src, {
        http: fakeHttp(new FetchBlockedError("https://www.rogersar.gov/Calendar.aspx?EID=1", "HTTP 403")).http,
        generate: fakeModel(tx, noPlace), actor: ACTOR, runId: blocked.run.id, now: NOW,
      });
      expect(r.outcome).toBe("blocked");
      const [s] = await tx.select().from(sources).where(eq(sources.id, blocked.src.id));
      expect(s).toMatchObject({ enabled: false, disabledReason: "blocked" });
      const [d] = await tx.select().from(agentActions).where(and(eq(agentActions.action, "disable"), eq(agentActions.entityId, s.id), eq(agentActions.job, "process")));
      expect(d.reason).toMatch(/A block means stop/);
    });
  });
});
