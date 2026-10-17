import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { type DbTx, getDb } from "@/lib/db/client";
import { benchmarkItems, benchmarkWeeks, events, feedDiscoveries, organizers, sources } from "@/lib/db/schema";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

/** Runs `fn` in a savepoint and expects Postgres to reject it with the named constraint. */
async function rejects(tx: DbTx, constraint: string, fn: (tx: DbTx) => Promise<unknown>) {
  let message = "";
  try {
    await tx.transaction(async (sp) => {
      await fn(sp);
    });
  } catch (err) {
    const cause = (err as { cause?: { constraint_name?: string; message?: string } }).cause;
    message = cause?.constraint_name ?? cause?.message ?? String(err);
  }
  expect(message).toContain(constraint);
}

const organizer = (tx: DbTx, over: Partial<typeof organizers.$inferInsert> = {}) =>
  tx
    .insert(organizers)
    .values({ slug: "test-org", name: "Test Organizer", organizerType: "government", city: "Pea Ridge", homeCounty: "Benton", homeState: "AR", ...over })
    .returning()
    .then((r) => r[0]);

describe("organizers (migration 0029)", () => {
  it("stores an organizer and links it to events", async () => {
    await inRollback(async (tx) => {
      const org = await organizer(tx, { website: "https://example.gov/", channel: "feed" });
      expect(org).toMatchObject({ status: "candidate", aliases: [], verification: {} });
      const [ev] = await tx.select({ id: events.id }).from(events).limit(1);
      if (ev) {
        const [after] = await tx.update(events).set({ organizerId: org.id }).where(eq(events.id, ev.id)).returning();
        expect(after.organizerId).toBe(org.id);
      }
    });
  });

  it("allows organizers based outside the area (owner, 2026-10-17); coverage stays on events", async () => {
    await inRollback(async (tx) => {
      const org = await organizer(tx, { slug: "vintage-market-days", organizerType: "business", city: "Oklahoma City", homeCounty: "Oklahoma", homeState: "OK", holdsEventsInArea: "yes" });
      expect(org).toMatchObject({ homeState: "OK", holdsEventsInArea: "yes" });
      expect((await organizer(tx, { slug: "unknown-org" })).holdsEventsInArea).toBe("unknown");
    });
  });

  it("enforces type, state, https, and verified-means-checked", async () => {
    await inRollback(async (tx) => {
      await rejects(tx, "organizers_type_check", (sp) => organizer(sp, { organizerType: "band" as never }));
      await rejects(tx, "organizers_state_check", (sp) => organizer(sp, { homeState: "Arkansas" }));
      await rejects(tx, "organizers_holds_events_check", (sp) => organizer(sp, { holdsEventsInArea: "maybe" as never }));
      await rejects(tx, "organizers_website_check", (sp) => organizer(sp, { website: "http://example.gov/" }));
      await rejects(tx, "organizers_verified_check", (sp) => organizer(sp, { status: "verified" }));
      await rejects(tx, "organizers_slug_check", (sp) => organizer(sp, { slug: "Not A Slug" }));
    });
  });
});

describe("feed_discoveries (migration 0029)", () => {
  const discovery = (tx: DbTx, organizerId: string, over: Partial<typeof feedDiscoveries.$inferInsert> = {}) =>
    tx
      .insert(feedDiscoveries)
      .values({ organizerId, url: "https://example.gov/events/?ical=1", kind: "ics", robotsResult: "allowed", robotsCheckedAt: new Date(), ...over })
      .returning()
      .then((r) => r[0]);

  it("keeps proposals source-free, and approvals tied to a source and a decider", async () => {
    await inRollback(async (tx) => {
      const org = await organizer(tx);
      const [src] = await tx.select({ id: sources.id }).from(sources).limit(1);
      const d = await discovery(tx, org.id, { sampleEvents: [{ title: "Story Time", startAt: "2026-10-21T16:00:00Z" }] });
      expect(d.status).toBe("proposed");
      await rejects(tx, "feed_discoveries_source_check", (sp) => discovery(sp, org.id, { url: "https://example.gov/a", sourceId: src.id }));
      await rejects(tx, "feed_discoveries_source_check", (sp) => discovery(sp, org.id, { url: "https://example.gov/b", status: "approved", decidedAt: new Date(), decidedBy: "human:owner" }));
      await rejects(tx, "feed_discoveries_decided_check", (sp) => discovery(sp, org.id, { url: "https://example.gov/c", status: "rejected" }));
      await rejects(tx, "feed_discoveries_robots_approved_check", (sp) =>
        discovery(sp, org.id, { url: "https://example.gov/d", status: "approved", robotsResult: "disallowed", sourceId: src.id, decidedAt: new Date(), decidedBy: "human:owner" }),
      );
      const approved = await discovery(tx, org.id, { url: "https://example.gov/e", status: "approved", sourceId: src.id, decidedAt: new Date(), decidedBy: "human:owner" });
      expect(approved.sourceId).toBe(src.id);
    });
  });

  it("holds at most 5 sample events, and one row per organizer and URL", async () => {
    await inRollback(async (tx) => {
      const org = await organizer(tx);
      const six = Array.from({ length: 6 }, (_, i) => ({ title: `Event ${i}`, startAt: "2026-10-21T16:00:00Z" }));
      await rejects(tx, "feed_discoveries_samples_check", (sp) => discovery(sp, org.id, { sampleEvents: six }));
      await discovery(tx, org.id);
      await rejects(tx, "feed_discoveries_organizer_url_uniq", (sp) => discovery(sp, org.id));
    });
  });
});

describe("benchmark (migration 0029)", () => {
  it("weeks start on Monday; results point at what they matched; tasks only for no-source misses", async () => {
    await inRollback(async (tx) => {
      await rejects(tx, "benchmark_weeks_monday_check", (sp) => sp.insert(benchmarkWeeks).values({ weekStart: "2026-10-14", createdBy: "human:owner" }));
      const [week] = await tx.insert(benchmarkWeeks).values({ weekStart: "2026-10-12", createdBy: "human:owner" }).returning();
      const item = (over: Partial<typeof benchmarkItems.$inferInsert>) =>
        (sp: DbTx) => sp.insert(benchmarkItems).values({ weekId: week.id, name: "Fall Festivities", eventDate: "2026-10-16", result: "missed", matchedAt: new Date(), ...over });

      await item({ missReason: "no_source", taskStatus: "open" })(tx);
      await rejects(tx, "benchmark_items_match_check", item({ result: "live" }));
      await rejects(tx, "benchmark_items_match_check", item({ result: "shadow" }));
      await rejects(tx, "benchmark_items_task_status_check", item({ missReason: "social_only", taskStatus: "open" }));
      const [ev] = await tx.select({ id: events.id }).from(events).limit(1);
      if (ev) {
        await rejects(tx, "benchmark_items_miss_reason_check", item({ result: "live", matchedEventId: ev.id, missReason: "other" }));
        await item({ result: "live", matchedEventId: ev.id })(tx);
      }
    });
  });
});
