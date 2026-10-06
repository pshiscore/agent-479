import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { humanActor } from "@/lib/actions/record";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, categories, eventDays, eventSources, eventTags, events, type ProposedEvent, sources, tags, venues } from "@/lib/db/schema";
import { addCheckedSource, approveProposal, createProposal, likelyMatches, mergeProposal, rejectProposal, ReviewError, setParentEvent } from "@/lib/review/proposals";
import { listEvents } from "@/lib/site/queries";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const OWNER = humanActor("owner");
const tag = randomUUID().slice(0, 6);
const START = "2027-10-15T13:00:00.000Z"; // 8 am Chicago

async function setup(tx: DbTx) {
  const [venue] = await tx.select().from(venues).where(eq(venues.active, true)).limit(1);
  const [category] = await tx.select().from(categories).where(eq(categories.slug, "festivals-markets"));
  const facts: ProposedEvent = {
    title: `Test Fair ${tag}`,
    startAt: START,
    endAt: "2027-10-18T21:00:00.000Z",
    allDay: false,
    venueId: venue.id,
    subSpace: null,
    categoryId: category.id,
    isFree: true,
    priceMin: null,
    priceMax: null,
    ageMin: null,
    ageMax: null,
    registrationRequired: null,
    inSpanish: false,
    tagSlugs: ["family-friendly"],
    ticketUrl: null,
    moreInfoUrl: "https://fair.example/2027",
    dailyHours: [],
  };
  const source = { url: "https://fair.example/2027", checkedAt: "2027-09-01", verifiedBy: "owner" as const, confirmed: "Oct 15-18, 2027, free" };
  return { venue, category, facts, source };
}

describe("review queue", () => {
  it("approving writes the event with its tags and owner source, logged; it shows on the site", async () => {
    await inRollback(async (tx) => {
      const { facts, source } = await setup(tx);
      const p = await createProposal(tx, { facts, sources: [source], origin: "owner_form", reasons: ["owner_draft"] }, { actor: OWNER });
      expect(p).toMatchObject({ status: "pending", reasons: ["owner_draft"] });

      const { event, proposal } = await approveProposal(tx, p.id, { actor: OWNER, note: "checked the fair's page" });
      expect(proposal).toMatchObject({ status: "approved", eventId: event.id, decidedBy: OWNER });
      expect(event).toMatchObject({ title: facts.title, isFree: true, freeBasis: "stated", primarySourceUrl: facts.moreInfoUrl, status: "scheduled" });

      const tagSlugs = (await tx.select({ slug: tags.slug }).from(eventTags).innerJoin(tags, eq(tags.id, eventTags.tagId)).where(eq(eventTags.eventId, event.id))).map((t) => t.slug).sort();
      expect(tagSlugs).toEqual(["family-friendly", "free"]);
      const [link] = await tx.select().from(eventSources).innerJoin(sources, eq(sources.id, eventSources.sourceId)).where(eq(eventSources.eventId, event.id));
      expect(link.event_sources).toMatchObject({ isPrimary: true, externalId: `proposal:${p.id}` });
      expect(link.sources).toMatchObject({ slug: "owner", enabled: false, disabledReason: "manual" });

      const logs = await tx.select().from(agentActions).where(eq(agentActions.entityId, event.id));
      expect(logs.map((l) => [l.action, l.actor])).toEqual([["insert", OWNER]]);

      const listed = await listEvents(tx, { from: new Date("2027-10-14T00:00:00Z"), to: new Date("2027-10-20T00:00:00Z") });
      expect(listed.map((e) => e.title)).toContain(facts.title);

      await expect(approveProposal(tx, p.id, { actor: OWNER })).rejects.toThrow(/already approved/);
    });
  });

  it("edit and approve uses the edits; code-owned tags can't be picked; inactive venues are refused", async () => {
    await inRollback(async (tx) => {
      const { facts, source } = await setup(tx);
      await expect(createProposal(tx, { facts: { ...facts, tagSlugs: ["free"] }, sources: [source], origin: "owner_form", reasons: ["owner_draft"] }, { actor: OWNER })).rejects.toThrow(/set from the facts/);
      const p = await createProposal(tx, { facts, sources: [source], origin: "owner_form", reasons: ["owner_draft"] }, { actor: OWNER });
      const { event } = await approveProposal(tx, p.id, { actor: OWNER, edits: { title: `Edited Fair ${tag}`, ageMin: 21, isFree: false, priceMin: 10, priceMax: 10 } });
      expect(event).toMatchObject({ title: `Edited Fair ${tag}`, isFree: false, freeBasis: null, priceText: "$10" });
      const tagSlugs = (await tx.select({ slug: tags.slug }).from(eventTags).innerJoin(tags, eq(tags.id, eventTags.tagId)).where(eq(eventTags.eventId, event.id))).map((t) => t.slug);
      expect(tagSlugs).toEqual(["21-plus"]); // family-friendly dropped for 21+

      const q = await createProposal(tx, { facts, sources: [source], origin: "owner_form", reasons: ["owner_draft"] }, { actor: OWNER });
      const [inactive] = await tx.insert(venues).values({ slug: `gone-${tag}`, name: `Gone ${tag}`, venueType: "theater", address: "1 Test St", city: "Eureka Springs", lat: 36.4, lng: -93.7, active: false, verification: {} }).returning();
      await expect(approveProposal(tx, q.id, { actor: OWNER, edits: { venueId: inactive.id } })).rejects.toThrow(/inactive/);
      await expect(approveProposal(tx, q.id, { actor: "agent:x" })).rejects.toBeInstanceOf(ReviewError);
    });
  });

  it("reject needs a reason; merge adds the page as another source of the existing event; checked sources are recorded", async () => {
    await inRollback(async (tx) => {
      const { facts, source } = await setup(tx);
      const first = await createProposal(tx, { facts, sources: [source], origin: "owner_form", reasons: ["owner_draft"] }, { actor: OWNER });
      const { event } = await approveProposal(tx, first.id, { actor: OWNER });

      // A second item for the same fair finds the first as its likely match.
      const lead = await createProposal(tx, { facts: { ...facts, title: `test fair ${tag}`, moreInfoUrl: "https://other.example/fair" }, sources: [{ url: "https://other.example/fair", fetchedAt: "2027-09-02" }], origin: "lead", reasons: ["lead_only"] }, { actor: "agent:leads" });
      expect(lead.matchEventId).toBe(event.id);
      expect((await likelyMatches(tx, lead.facts)).map((m) => m.id)).toContain(event.id);

      const checked = await addCheckedSource(tx, lead.id, { actor: OWNER, url: "https://fair.example/2027", confirmed: "Same dates on the official page" });
      expect(checked.sources).toContainEqual(expect.objectContaining({ url: "https://fair.example/2027", verifiedBy: "owner" }));

      const { proposal } = await mergeProposal(tx, lead.id, event.id, { actor: OWNER, note: "same fair" });
      expect(proposal).toMatchObject({ status: "merged", eventId: event.id });
      const links = await tx.select().from(eventSources).where(eq(eventSources.eventId, event.id));
      expect(links.map((l) => [l.externalId.startsWith("proposal:"), l.isPrimary]).sort()).toEqual([[true, false], [true, true]]);
      const [after] = await tx.select().from(events).where(eq(events.id, event.id));
      expect(after.title).toBe(facts.title); // merge never changes fields

      const r = await createProposal(tx, { facts, sources: [source], origin: "owner_form", reasons: ["owner_draft"] }, { actor: OWNER });
      await expect(rejectProposal(tx, r.id, { actor: OWNER, reason: "" })).rejects.toThrow(/reason/);
      expect(await rejectProposal(tx, r.id, { actor: OWNER, reason: "duplicate" })).toMatchObject({ status: "rejected", decisionNote: "duplicate" });
      const logs = await tx.select().from(agentActions).where(and(eq(agentActions.entityType, "event_proposal"), eq(agentActions.entityId, r.id)));
      expect(logs.map((l) => l.action).sort()).toEqual(["insert", "update"]);
    });
  });

  it("stores per-day hours in UTC on approval, and refuses days outside the event", async () => {
    await inRollback(async (tx) => {
      const { facts, source } = await setup(tx);
      const dailyHours = [
        { day: "2027-10-15", opens: "08:00", closes: "17:00" },
        { day: "2027-10-18", opens: "08:00", closes: "16:00" },
      ];
      const p = await createProposal(tx, { facts: { ...facts, dailyHours }, sources: [source], origin: "owner_form", reasons: ["owner_draft"] }, { actor: OWNER });
      const { event } = await approveProposal(tx, p.id, { actor: OWNER });
      const days = await tx.select().from(eventDays).where(eq(eventDays.eventId, event.id));
      expect(days.map((d) => [d.day, d.opensAt?.toISOString(), d.closesAt?.toISOString()]).sort()).toEqual([
        ["2027-10-15", "2027-10-15T13:00:00.000Z", "2027-10-15T22:00:00.000Z"],
        ["2027-10-18", "2027-10-18T13:00:00.000Z", "2027-10-18T21:00:00.000Z"],
      ]);
      const [log] = await tx.select().from(agentActions).where(eq(agentActions.entityId, event.id));
      expect((log.after as { days: unknown[] }).days).toHaveLength(2);
      await expect(createProposal(tx, { facts: { ...facts, dailyHours: [{ day: "2027-10-20", opens: "08:00", closes: "17:00" }] }, sources: [source], origin: "owner_form", reasons: ["owner_draft"] }, { actor: OWNER })).rejects.toThrow(/outside the event's dates/);
    });
  });

  it("festival parts: approve with Part of, refuse outside the dates or nesting, link and unlink logged, shown in lists", async () => {
    await inRollback(async (tx) => {
      const { facts, source } = await setup(tx);
      // The festival: Oct 15-18, 2027.
      const fest = (await approveProposal(tx, (await createProposal(tx, { facts, sources: [source], origin: "owner_form", reasons: ["owner_draft"] }, { actor: OWNER })).id, { actor: OWNER })).event;
      const part = (f: Partial<ProposedEvent>) => createProposal(tx, { facts: { ...facts, title: `Part ${tag} ${Math.random()}`, endAt: null, ...f }, sources: [source], origin: "owner_form", reasons: ["owner_draft"] }, { actor: OWNER });

      const night = (await approveProposal(tx, (await part({ title: `Light Night ${tag}`, startAt: "2027-10-16T23:00:00.000Z", parentEventId: fest.id })).id, { actor: OWNER })).event;
      expect(night.parentEventId).toBe(fest.id);
      await expect(approveProposal(tx, (await part({ startAt: "2027-10-25T23:00:00.000Z", parentEventId: fest.id })).id, { actor: OWNER })).rejects.toThrow(/starts outside/);
      await expect(approveProposal(tx, (await part({ startAt: "2027-10-16T20:00:00.000Z", parentEventId: night.id })).id, { actor: OWNER })).rejects.toThrow(/itself part of another/);

      // An existing event (say, from a city calendar) linked, then unlinked; both logged.
      const parade = (await approveProposal(tx, (await part({ title: `Parade ${tag}`, startAt: "2027-10-17T23:30:00.000Z" })).id, { actor: OWNER })).event;
      await setParentEvent(tx, parade.id, fest.id, { actor: OWNER });
      await expect(setParentEvent(tx, fest.id, parade.id, { actor: OWNER })).rejects.toThrow(/its own parts|itself part/);
      await expect(setParentEvent(tx, parade.id, fest.id, { actor: "agent:x" })).rejects.toBeInstanceOf(ReviewError);

      const listed = await listEvents(tx, { from: new Date("2027-10-15T00:00:00Z"), to: new Date("2027-10-20T00:00:00Z") });
      expect(listed.find((e) => e.id === fest.id)?.parts.map((p) => p.title)).toEqual([`Light Night ${tag}`, `Parade ${tag}`]);
      expect(listed.find((e) => e.id === night.id)?.parent).toEqual({ id: fest.id, title: facts.title });

      expect((await setParentEvent(tx, parade.id, null, { actor: OWNER })).parentEventId).toBeNull();
      const logs = await tx.select().from(agentActions).where(and(eq(agentActions.entityId, parade.id), eq(agentActions.action, "update")));
      expect(logs.map((l) => l.reason)).toEqual(expect.arrayContaining([expect.stringMatching(/^Part of "/), expect.stringMatching(/^No longer part/)]));
    });
  });

  it("a proposal needs a source and a reason; the database refuses a decision without a decider", async () => {
    await inRollback(async (tx) => {
      const { facts, source } = await setup(tx);
      await expect(createProposal(tx, { facts, sources: [], origin: "owner_form", reasons: ["owner_draft"] }, { actor: OWNER })).rejects.toThrow(/at least one source/);
      await expect(createProposal(tx, { facts, sources: [source], origin: "owner_form", reasons: [] }, { actor: OWNER })).rejects.toThrow(/why/);
    });
  });
});
