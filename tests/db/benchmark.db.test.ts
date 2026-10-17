import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { addLines, markWrongMatch, recheckWeek, setMissReason, setTaskStatus, weekItems, weekSummaries } from "@/lib/benchmark/service";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, categories, eventProposals, events, type ProposedEvent, venues } from "@/lib/db/schema";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const ACTOR = "human:owner";
// A week far from real data, so dev events can't match.
const WEEK = "2031-03-10";

async function fixtures(tx: DbTx) {
  const [venue] = await tx.select().from(venues).limit(1);
  const [cat] = await tx.select().from(categories).limit(1);
  let n = 0;
  const event = async (title: string, start: string, end: string | null = null, status: "scheduled" | "hidden" = "scheduled") => {
    const [ev] = await tx
      .insert(events)
      .values({ slug: `bm-${++n}-${Date.now()}`, title, normalizedTitle: title.toLowerCase(), startAt: new Date(start), endAt: end ? new Date(end) : null, venueId: venue.id, categoryId: cat.id, status })
      .returning();
    return ev;
  };
  const proposal = async (title: string, start: string, over: Partial<typeof eventProposals.$inferInsert> = {}) => {
    const facts: ProposedEvent = { title, startAt: start, endAt: null, allDay: false, venueId: venue.id, subSpace: null, categoryId: cat.id, isFree: null, priceMin: null, priceMax: null, ageMin: null, ageMax: null, registrationRequired: null, inSpanish: false, tagSlugs: [], ticketUrl: null, moreInfoUrl: "https://example.org/", dailyHours: [] };
    const [p] = await tx.insert(eventProposals).values({ origin: "owner_form", reasons: ["owner_draft"], facts, ...over }).returning();
    return p;
  };
  return { event, proposal };
}

describe("benchmark", () => {
  it("matches typed lines: ±1 day, multi-day ranges, review items, and misses; everything logged", async () => {
    await inRollback(async (tx) => {
      const f = await fixtures(tx);
      const fest = await f.event("Zephyr Lantern Festival", "2031-03-13T23:00:00Z", "2031-03-17T03:00:00Z");
      const late = await f.event("Quillon Trivia Night", "2031-03-12T01:00:00Z");
      const waiting = await f.proposal("Marrowby Book Swap", "2031-03-14T15:00:00Z");

      const r = await addLines(
        tx,
        { weekStart: WEEK, label: "test roundup", text: "Zephyr Lantern Festival, Mar 15\nQuillon Trivia Night, Mar 12\nMarrowby Book Swap, Mar 14\nOberlin Kite Day, Mar 15\nnot a line" },
        { actor: ACTOR },
      );
      expect(r).toMatchObject({ added: 4, repeated: 0, errors: [{ line: "not a line" }] });
      const items = await weekItems(tx, r.weekId);
      const by = (name: string) => items.find((i) => i.name === name)!;
      // Typed date inside a multi-day event's range.
      expect(by("Zephyr Lantern Festival")).toMatchObject({ result: "live", matchedEventId: fest.id, eventTitle: "Zephyr Lantern Festival" });
      // Mar 11, 8 pm in Chicago (UTC next day), typed as Mar 12: within ±1 day.
      expect(by("Quillon Trivia Night")).toMatchObject({ result: "live", matchedEventId: late.id });
      expect(by("Marrowby Book Swap")).toMatchObject({ result: "review", matchedProposalId: waiting.id, proposalTitle: "Marrowby Book Swap" });
      expect(by("Oberlin Kite Day")).toMatchObject({ result: "missed", missReason: null });

      const logged = await tx.select().from(agentActions).where(and(eq(agentActions.entityType, "benchmark_item"), eq(agentActions.action, "insert")));
      expect(logged.filter((a) => items.some((i) => i.id === a.entityId))).toHaveLength(4);

      // Typing the same lines again adds nothing.
      expect(await addLines(tx, { weekStart: WEEK, label: "test roundup", text: "Oberlin Kite Day, Mar 15" }, { actor: ACTOR })).toMatchObject({ weekId: r.weekId, added: 0, repeated: 1 });

      const [week] = (await weekSummaries(tx)).filter((w) => w.id === r.weekId);
      expect(week.coverage).toMatchObject({ total: 4, live: 2, review: 1, missed: 1, unexplained: 1, livePct: 50, potentialPct: 75 });
    });
  });

  it("a no-source miss opens a registry task; other reasons drop it; outside-area misses leave the total", async () => {
    await inRollback(async (tx) => {
      const r = await addLines(tx, { weekStart: WEEK, label: null, text: "Oberlin Kite Day, Mar 15\nVellmore Fair, Mar 15" }, { actor: ACTOR });
      const [kite, fair] = (await weekItems(tx, r.weekId)).sort((a, b) => a.name.localeCompare(b.name));
      expect((await setMissReason(tx, kite.id, "no_source", { actor: ACTOR, note: "Kite club, Facebook only?" })).taskStatus).toBe("open");
      expect((await setTaskStatus(tx, kite.id, "done", { actor: ACTOR })).taskStatus).toBe("done");
      expect((await setMissReason(tx, kite.id, "social_only", { actor: ACTOR })).taskStatus).toBeNull();
      await setMissReason(tx, fair.id, "outside_area", { actor: ACTOR });
      const [week] = (await weekSummaries(tx)).filter((w) => w.id === r.weekId);
      expect(week.coverage).toMatchObject({ total: 1, outside: 1, missed: 1, unexplained: 0, livePct: 0 });
    });
  });

  it("re-checks pick up events that arrived later, but never a match the owner marked wrong", async () => {
    await inRollback(async (tx) => {
      const f = await fixtures(tx);
      const r = await addLines(tx, { weekStart: WEEK, label: null, text: "Oberlin Kite Day, Mar 15\nZephyr Lantern Festival, Mar 15" }, { actor: ACTOR });
      await f.event("Oberlin Kite Day", "2031-03-15T17:00:00Z");
      await f.event("Zephyr Lantern Festival", "2031-03-15T17:00:00Z");
      const before = await weekItems(tx, r.weekId);
      const zephyr = before.find((i) => i.name === "Zephyr Lantern Festival")!;
      await setMissReason(tx, zephyr.id, "no_source", { actor: ACTOR });

      expect(await recheckWeek(tx, r.weekId, { actor: ACTOR })).toEqual({ checked: 2, changed: 2 });
      const after = await weekItems(tx, r.weekId);
      // A found event clears the miss reason and its task.
      expect(after.find((i) => i.id === zephyr.id)).toMatchObject({ result: "live", missReason: null, taskStatus: null });

      const kite = after.find((i) => i.name === "Oberlin Kite Day")!;
      await markWrongMatch(tx, kite.id, { actor: ACTOR });
      expect(await recheckWeek(tx, r.weekId, { actor: ACTOR })).toEqual({ checked: 1, changed: 0 });
      expect((await weekItems(tx, r.weekId)).find((i) => i.id === kite.id)).toMatchObject({ result: "missed", matchOverridden: true });
    });
  });

  it("a hidden event suggests a reason without choosing it; reasons only go on misses", async () => {
    await inRollback(async (tx) => {
      const f = await fixtures(tx);
      await f.event("Oberlin Kite Day", "2031-03-15T17:00:00Z", null, "hidden");
      await f.event("Zephyr Lantern Festival", "2031-03-15T17:00:00Z");
      const r = await addLines(tx, { weekStart: WEEK, label: null, text: "Oberlin Kite Day, Mar 15\nZephyr Lantern Festival, Mar 15" }, { actor: ACTOR });
      const items = await weekItems(tx, r.weekId);
      expect(items.find((i) => i.name === "Oberlin Kite Day")).toMatchObject({ result: "missed", missReason: null, suggestedReason: "rejected" });
      await expect(setMissReason(tx, items.find((i) => i.name === "Zephyr Lantern Festival")!.id, "other", { actor: ACTOR })).rejects.toThrow(/only a missed item/);
      await expect(addLines(tx, { weekStart: "2031-03-11", label: null, text: "Oberlin Kite Day, Mar 15" }, { actor: ACTOR })).rejects.toThrow(/Monday/);
    });
  });
});
