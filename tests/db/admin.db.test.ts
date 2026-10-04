import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { agentActor, humanActor, proposeOnce, recordAction } from "@/lib/actions/record";
import { RollbackError, rollbackAction } from "@/lib/actions/rollback";
import { decideProposal, ProposalError } from "@/lib/admin/proposals";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, categories, eventSources, events, eventTags, rawRecords, sources, tags, venueExternalIds, venues } from "@/lib/db/schema";
import { mergeEvents } from "@/lib/pipeline/dedup/merge";
import { processRecord } from "@/lib/pipeline/process";
import { disableManually } from "@/lib/sources/admin";
import { startRun } from "@/lib/runs";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const OWNER = humanActor("owner");
const AGENT = agentActor("process");
const tag = randomUUID().slice(0, 8);

async function setup(tx: DbTx) {
  const [src] = await tx
    .insert(sources)
    .values({ slug: `adm-${tag}-${randomUUID().slice(0, 4)}`, name: "A", kind: "ics", fetcher: "ics", baseUrl: "https://x.example/", trustLevel: 4, fetchIntervalMinutes: 60, termsNotes: "t", enabled: true, disabledReason: null })
    .returning();
  const [venue] = await tx.select().from(venues).where(eq(venues.slug, "rogers-historical-museum"));
  const [cat] = await tx.select().from(categories).where(eq(categories.slug, "talks-learning"));
  const [free] = await tx.select().from(tags).where(eq(tags.slug, "free"));
  let n = 0;
  const add = async (title: string) => {
    const [ev] = await tx
      .insert(events)
      .values({ slug: `adm-${tag}-${++n}`, title, normalizedTitle: title.toLowerCase(), startAt: new Date("2027-09-01T00:00:00Z"), venueId: venue.id, categoryId: cat.id })
      .returning();
    await tx.insert(eventSources).values({ eventId: ev.id, sourceId: src.id, externalId: `x-${tag}-${n}`, isPrimary: true });
    return ev;
  };
  return { src, venue, cat, free, add };
}

/** An event update the way the pipeline logs it: before and after snapshots with tagIds. */
async function loggedUpdate(tx: DbTx, ev: typeof events.$inferSelect, set: Partial<typeof events.$inferInsert>, tagIds: string[]) {
  const before = { ...ev, tagIds: [] as string[] };
  const [after] = await tx.update(events).set(set).where(eq(events.id, ev.id)).returning();
  if (tagIds.length) await tx.insert(eventTags).values(tagIds.map((tagId) => ({ eventId: ev.id, tagId })));
  return recordAction(tx, { actor: AGENT, action: "update", entityType: "event", entityId: ev.id, before, after: { ...after, tagIds }, reason: "re-enrich" });
}

describe("rollbackAction", () => {
  it("restores an event update (fields and tags), links both actions, and won't do it twice", async () => {
    await inRollback(async (tx) => {
      const { add, free } = await setup(tx);
      const ev = await add("Lecture");
      const a = await loggedUpdate(tx, ev, { title: "LECTURE (wrong)", isFree: true, freeBasis: "stated" }, [free.id]);
      const r = await rollbackAction(tx, a.id, { actor: OWNER, reason: "bad re-enrich" });
      expect(r).toMatchObject({ action: "rollback", revertsActionId: a.id, actor: OWNER });
      const [now] = await tx.select().from(events).where(eq(events.id, ev.id));
      expect(now).toMatchObject({ title: "Lecture", isFree: null, freeBasis: null });
      expect(await tx.select().from(eventTags).where(eq(eventTags.eventId, ev.id))).toHaveLength(0);
      const [orig] = await tx.select().from(agentActions).where(eq(agentActions.id, a.id));
      expect(orig.revertedByActionId).toBe(r.id);
      await expect(rollbackAction(tx, a.id, { actor: OWNER, reason: "again" })).rejects.toThrow(/already rolled back/);
    });
  });

  it("refuses when the event changed after the action, and refuses agents", async () => {
    await inRollback(async (tx) => {
      const { add } = await setup(tx);
      const ev = await add("Lecture");
      const a = await loggedUpdate(tx, ev, { title: "Lecture v2" }, []);
      await tx.update(events).set({ title: "Lecture v3" }).where(eq(events.id, ev.id));
      await expect(rollbackAction(tx, a.id, { actor: OWNER, reason: "undo v2" })).rejects.toThrow(/changed after/);
      await expect(rollbackAction(tx, a.id, { actor: AGENT, reason: "undo v2" })).rejects.toBeInstanceOf(RollbackError);
    });
  });

  it("hides an inserted event rather than deleting it", async () => {
    await inRollback(async (tx) => {
      const { add } = await setup(tx);
      const ev = await add("Spam listing");
      const a = await recordAction(tx, { actor: AGENT, action: "insert", entityType: "event", entityId: ev.id, after: ev, reason: "new" });
      await rollbackAction(tx, a.id, { actor: OWNER, reason: "not a real event" });
      const [now] = await tx.select().from(events).where(eq(events.id, ev.id));
      expect(now.status).toBe("hidden");
    });
  });

  it("unmerges: both events, tags, and source rows as before", async () => {
    await inRollback(async (tx) => {
      const { add, free } = await setup(tx);
      const survivor = await add("Ziggy Marley");
      const loser = await add("Ziggy Marley - Tour");
      await tx.update(events).set({ endAt: new Date("2027-09-01T03:00:00Z") }).where(eq(events.id, loser.id));
      await tx.insert(eventTags).values({ eventId: loser.id, tagId: free.id });
      await mergeEvents(tx, { survivorId: survivor.id, loserId: loser.id, candidateId: null, actor: AGENT, reason: "dup", now: new Date() });
      const [m] = await tx.select().from(agentActions).where(and(eq(agentActions.action, "merge"), eq(agentActions.entityId, survivor.id)));

      const r = await rollbackAction(tx, m.id, { actor: OWNER, reason: "two different shows" });
      expect(r.action).toBe("unmerge");
      const [s] = await tx.select().from(events).where(eq(events.id, survivor.id));
      const [l] = await tx.select().from(events).where(eq(events.id, loser.id));
      expect(s.endAt).toBeNull();
      expect(l).toMatchObject({ status: "scheduled", canonicalEventId: null });
      expect(await tx.select().from(eventTags).where(eq(eventTags.eventId, survivor.id))).toHaveLength(0);
      expect(await tx.select().from(eventTags).where(eq(eventTags.eventId, loser.id))).toHaveLength(1);
      const [ls] = await tx.select().from(eventSources).where(eq(eventSources.eventId, loser.id));
      expect(ls).toMatchObject({ isPrimary: true });
    });
  });

  it("restores a source the owner disabled", async () => {
    await inRollback(async (tx) => {
      const { src } = await setup(tx);
      await disableManually(tx, src.slug, "Testing the rollback path", OWNER);
      const [a] = await tx.select().from(agentActions).where(and(eq(agentActions.entityId, src.id), eq(agentActions.action, "disable")));
      await rollbackAction(tx, a.id, { actor: OWNER, reason: "disabled by mistake" });
      const [s] = await tx.select().from(sources).where(eq(sources.id, src.id));
      expect(s).toMatchObject({ enabled: true, disabledReason: null });
    });
  });

  it("says what isn't revertible", async () => {
    await inRollback(async (tx) => {
      const { add } = await setup(tx);
      const ev = await add("X");
      const a = await recordAction(tx, { actor: AGENT, action: "insert", entityType: "dedup_candidate", entityId: ev.id, after: {}, reason: "pair" });
      await expect(rollbackAction(tx, a.id, { actor: OWNER, reason: "try anyway" })).rejects.toThrow(/isn.t supported/);
    });
  });
});

describe("decideProposal", () => {
  async function needsVenueRecord(tx: DbTx, srcId: string, startAt: string) {
    const run = await startRun(tx, "process");
    const facts = {
      title: "Parade", startAt, endAt: null, allDay: false, timeTba: false, status: "scheduled", sourceUrl: null, ticketUrl: null,
      location: { text: "- Rogers AR 72756", name: null, room: null, street: null, city: "Rogers", externalVenueId: null },
      price: { min: null, max: null, currency: null }, performers: [], sourceCategories: [], legalAgeEnforced: null, recurrence: null, timezoneAssumed: false,
    };
    const [rec] = await tx
      .insert(rawRecords)
      .values({ sourceId: srcId, runId: run.id, externalId: randomUUID(), contentHash: "h", status: "needs_venue", locationKey: "nolocation:rogers", facts, payload: { format: "ics", feed: {}, event: {} } })
      .returning();
    return rec;
  }
  const matchProposal = (tx: DbTx, recId: string, venueId: string) =>
    proposeOnce(tx, {
      actor: AGENT, action: "propose_venue_match", entityType: "raw_record", approvalStatus: "pending", dedupeKey: `match:${recId}:${venueId}`,
      after: { rawRecordId: recId, venueId, venueSlug: "rogers-historical-museum", subSpace: null }, reason: "detail page names the museum",
    });

  it("approving a venue match pins the venue, queues the record, logs the note, and process keeps the pin", async () => {
    await inRollback(async (tx) => {
      const { src, venue } = await setup(tx);
      const rec = await needsVenueRecord(tx, src.id, "2027-09-05T00:00:00.000Z");
      const p = (await matchProposal(tx, rec.id, venue.id))!;
      const r = await decideProposal(tx, p.id, "approved", { actor: OWNER, note: "yes, the parade starts there" });
      expect(r.effect).toMatch(/venue pinned/);
      const [after] = await tx.select().from(rawRecords).where(eq(rawRecords.id, rec.id));
      expect(after).toMatchObject({ status: "mapped", venueId: venue.id, venueMatchedBy: "owner" });
      const [log] = await tx.select().from(agentActions).where(and(eq(agentActions.entityType, "proposal"), eq(agentActions.entityId, p.id)));
      expect(log.reason).toMatch(/yes, the parade starts there/);
      await expect(decideProposal(tx, p.id, "rejected", { actor: OWNER, note: "changed my mind" })).rejects.toThrow(/already approved/);

      // The source changes the listing; reprocessing keeps the owner's venue.
      const [again] = await tx.update(rawRecords).set({ status: "pending" }).where(eq(rawRecords.id, rec.id)).returning();
      const [srcRow] = await tx.select().from(sources).where(eq(sources.id, src.id));
      const out = await processRecord(tx, { ...again, payload: { format: "ics", feed: { url: "https://x.example/f.ics", defaultTimezone: "America/Chicago", timezones: ["America/Chicago"] }, event: { uid: "1", recurrenceId: null, summary: "Parade", dtstart: { value: "20270904T190000", tzid: "America/Chicago", isDate: false }, dtend: null, duration: null, rrule: null, rdate: [], exdate: [], location: "- Rogers AR 72756", geo: null, url: null, status: "CONFIRMED", categories: [], sequence: null, lastModified: null } } }, srcRow, { now: new Date("2026-10-04T15:00:00Z") });
      expect(out).toEqual({ outcome: "mapped", detail: "owner" });
    });
  });

  it("only records a past event's match; rejections and agents are handled", async () => {
    await inRollback(async (tx) => {
      const { src, venue } = await setup(tx);
      const past = await needsVenueRecord(tx, src.id, "2020-01-01T00:00:00.000Z");
      const p = (await matchProposal(tx, past.id, venue.id))!;
      expect((await decideProposal(tx, p.id, "approved", { actor: OWNER, note: "fine" })).effect).toMatch(/already past/);
      const [still] = await tx.select().from(rawRecords).where(eq(rawRecords.id, past.id));
      expect(still.status).toBe("needs_venue");

      const other = await needsVenueRecord(tx, src.id, "2027-09-05T00:00:00.000Z");
      const q = (await matchProposal(tx, other.id, venue.id))!;
      await expect(decideProposal(tx, q.id, "approved", { actor: AGENT, note: "auto" })).rejects.toBeInstanceOf(ProposalError);
      await decideProposal(tx, q.id, "rejected", { actor: OWNER, note: "not the museum" });
      const [pq] = await tx.select().from(agentActions).where(eq(agentActions.id, q.id));
      expect(pq).toMatchObject({ approvalStatus: "rejected", reviewedBy: OWNER });
    });
  });

  it("approving a Ticketmaster link writes the link, logged", async () => {
    await inRollback(async (tx) => {
      const { venue } = await setup(tx);
      const [tm] = await tx.select().from(sources).where(eq(sources.slug, "ticketmaster"));
      const tmVenueId = `TMV-${tag}`;
      const p = (await proposeOnce(tx, {
        actor: AGENT, action: "propose_link", entityType: "venue_external_id", approvalStatus: "pending", dedupeKey: `link:${tmVenueId}`,
        after: { sourceId: tm.id, tmVenueId, tmName: "Rogers Historical Museum", venueId: venue.id, venueSlug: venue.slug }, reason: "same name",
      }))!;
      expect((await decideProposal(tx, p.id, "approved", { actor: OWNER, note: "checked on TM" })).effect).toBe("link written");
      const [link] = await tx.select().from(venueExternalIds).where(eq(venueExternalIds.externalId, tmVenueId));
      expect(link.venueId).toBe(venue.id);
    });
  });
});
