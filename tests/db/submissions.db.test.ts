import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { categories, eventProposals, eventSubmissions, venues } from "@/lib/db/schema";
import { approveProposal, rejectProposal } from "@/lib/review/proposals";
import { purgeSubmitterEmails } from "@/lib/submissions/purge";
import { LIMITS, submitEvent } from "@/lib/submissions/submit";
import { issueToken } from "@/lib/submissions/token";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});
beforeEach(() => {
  // The token's key comes from CRON_SECRET; tests need one even when .env.local leaves it empty.
  if (!process.env.CRON_SECRET) process.env.CRON_SECRET = "test-secret";
});

const NOW = new Date("2026-10-20T15:00:00Z");
const EMAIL = "organizer-test@example.org";
const form = (over: Record<string, string> = {}) => ({
  title: "Harvest Hoedown",
  date: "2026-11-07",
  startTime: "18:00",
  endDate: "",
  endTime: "",
  place: "Town Square, 1 Main St",
  city: "Prairie Grove",
  eventUrl: "https://example.org/hoedown",
  free: "yes",
  organizer: "Prairie Grove Volunteers",
  email: EMAIL,
  note: "Rain date the next day.",
  website: "",
  token: issueToken(NOW.getTime() - 60_000)!,
  ...over,
});

describe("submit an event", () => {
  it("creates a review item and the submitter row; the log never holds the email", async () => {
    await inRollback(async (tx) => {
      const r = await submitEvent(tx, form(), { now: NOW });
      expect(r).toMatchObject({ ok: true });
      const id = (r as { proposalId: string }).proposalId;
      const [p] = await tx.select().from(eventProposals).where(eq(eventProposals.id, id));
      expect(p).toMatchObject({ origin: "submission", status: "pending", reasons: ["submitted"] });
      expect(p.facts).toMatchObject({ title: "Harvest Hoedown", venueId: null, moreInfoUrl: "https://example.org/hoedown" });
      const [s] = await tx.select().from(eventSubmissions).where(eq(eventSubmissions.proposalId, id));
      expect(s).toMatchObject({ email: EMAIL, placeText: "Town Square, 1 Main St, Prairie Grove", organizerName: "Prairie Grove Volunteers" });
      const [{ n }] = (await tx.execute(sql`select count(*)::int n from agent_actions where (before::text like ${`%${EMAIL}%`} or after::text like ${`%${EMAIL}%`} or reason like ${`%${EMAIL}%`})`)) as unknown as { n: number }[];
      expect(n).toBe(0);
    });
  });

  it("a filled hidden field gets a quiet thanks and stores nothing; bad or quick tokens are refused", async () => {
    await inRollback(async (tx) => {
      const before = await tx.select().from(eventSubmissions);
      expect(await submitEvent(tx, form({ website: "http://spam.example" }), { now: NOW })).toEqual({ ok: true, proposalId: null });
      expect(await tx.select().from(eventSubmissions)).toHaveLength(before.length);
      expect(await submitEvent(tx, form({ token: issueToken(NOW.getTime() - 1000)! }), { now: NOW })).toMatchObject({ ok: false, error: expect.stringMatching(/quick/) });
      expect(await submitEvent(tx, form({ token: "1.abc" }), { now: NOW })).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
    });
  });

  it("flags out-of-area events, refuses past dates, and limits one address per day", async () => {
    await inRollback(async (tx) => {
      const out = await submitEvent(tx, form({ city: "Eureka Springs" }), { now: NOW });
      const [p] = await tx.select().from(eventProposals).where(eq(eventProposals.id, (out as { proposalId: string }).proposalId));
      expect(p.reasons).toEqual(["submitted", "outside_coverage_area"]);
      expect(await submitEvent(tx, form({ date: "2026-10-01" }), { now: NOW })).toMatchObject({ ok: false, fields: { date: expect.any(String) } });
      for (let i = 1; i < LIMITS.perEmailPerDay; i++) expect(await submitEvent(tx, form({ title: `Event ${i}` }), { now: NOW })).toMatchObject({ ok: true });
      expect(await submitEvent(tx, form({ title: "One too many" }), { now: NOW })).toMatchObject({ ok: false, error: expect.stringMatching(/tomorrow/) });
    });
  });

  it("the owner approves with a venue and category; the email and note are deleted 30 days after the decision", async () => {
    await inRollback(async (tx) => {
      const a = (await submitEvent(tx, form(), { now: NOW })) as { proposalId: string };
      const b = (await submitEvent(tx, form({ title: "Second Event" }), { now: NOW })) as { proposalId: string };
      const [venue] = await tx.select().from(venues).where(eq(venues.active, true)).limit(1);
      const [cat] = await tx.select().from(categories).where(eq(categories.active, true)).limit(1);
      await approveProposal(tx, a.proposalId, { actor: "human:owner", note: "Checked their page", edits: { venueId: venue.id, categoryId: cat.id } });
      await rejectProposal(tx, b.proposalId, { actor: "human:owner", reason: "Private party", kind: "not_public" });

      expect(await purgeSubmitterEmails(tx, new Date(Date.now() + 29 * 86_400_000), "agent:maintenance", null)).toBe(0);
      expect(await purgeSubmitterEmails(tx, new Date(Date.now() + 31 * 86_400_000), "agent:maintenance", null)).toBe(2);
      const rows = await tx.select().from(eventSubmissions).where(sql`${eventSubmissions.proposalId} in (${a.proposalId}, ${b.proposalId})`);
      expect(rows.every((r) => r.email === null && r.note === null && r.purgedAt)).toBe(true);
      expect(rows.map((r) => r.placeText)).toEqual(["Town Square, 1 Main St, Prairie Grove", "Town Square, 1 Main St, Prairie Grove"]);
      const [{ n }] = (await tx.execute(sql`select count(*)::int n from agent_actions where before::text like ${`%${EMAIL}%`} or after::text like ${`%${EMAIL}%`}`)) as unknown as { n: number }[];
      expect(n).toBe(0);
    });
  });
});
