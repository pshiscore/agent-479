import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { agentActor } from "@/lib/actions/record";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, categories, events, rawRecords, sources, venues } from "@/lib/db/schema";
import { proposeCategoriesFromHints } from "@/lib/pipeline/category-themes";
import { archiveExpiredNeedsVenue } from "@/lib/pipeline/maintenance";
import { startRun } from "@/lib/runs";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const NOW = new Date("2026-10-20T12:00:00Z");

describe("archiveExpiredNeedsVenue", () => {
  it("archives needs_venue records whose event is over, and keeps upcoming ones", async () => {
    await inRollback(async (tx) => {
      const [src] = await tx.select().from(sources).where(eq(sources.slug, "city-bentonville"));
      const run = await startRun(tx, "process");
      const rec = (startAt: string) => ({
        sourceId: src.id, runId: run.id, externalId: randomUUID(), contentHash: "h", payload: {},
        status: "needs_venue" as const, locationKey: "nolocation:bentonville", facts: { title: "T", startAt, endAt: null },
      });
      const [past, future] = await tx.insert(rawRecords).values([rec("2026-10-03T12:00:00.000Z"), rec("2026-12-12T00:00:00.000Z")]).returning();
      expect(await archiveExpiredNeedsVenue(tx, NOW)).toBeGreaterThanOrEqual(1);
      const [p] = await tx.select().from(rawRecords).where(eq(rawRecords.id, past.id));
      const [f] = await tx.select().from(rawRecords).where(eq(rawRecords.id, future.id));
      expect(p).toMatchObject({ status: "skipped", skipReason: "needs_venue_expired" });
      expect(f.status).toBe("needs_venue");
    });
  });
});

describe("proposeCategoriesFromHints", () => {
  async function eventsWithHint(tx: DbTx, hint: string, n: number) {
    const [cat] = await tx.select().from(categories).where(eq(categories.slug, "community"));
    const [venue] = await tx.select().from(venues).limit(1);
    for (let i = 0; i < n; i++) {
      const [ev] = await tx
        .insert(events)
        .values({ slug: `t-${randomUUID()}`, title: "T", normalizedTitle: "t", startAt: NOW, venueId: venue.id, categoryId: cat.id })
        .returning();
      await tx.insert(agentActions).values({
        actor: "agent:process", action: "insert", entityType: "event", entityId: ev.id, reason: "test", createdAt: NOW,
        after: { _meta: { closestMissingCategory: i % 2 ? `${hint} drives` : hint } },
      });
    }
  }

  it("proposes a theme at 15 events in 30 days, once, and never one the owner rejected", async () => {
    await inRollback(async (tx) => {
      const theme = `zz test theme ${randomUUID().slice(0, 6)}`;
      await eventsWithHint(tx, theme, 14);
      await proposeCategoriesFromHints(tx, { actor: agentActor("maintenance"), now: NOW });
      const mine = () => tx.select().from(agentActions).where(and(eq(agentActions.action, "propose_category"), eq(agentActions.dedupeKey, `category:${theme}`)));
      expect(await mine()).toHaveLength(0);
      await eventsWithHint(tx, theme, 1);
      await proposeCategoriesFromHints(tx, { actor: agentActor("maintenance"), now: NOW });
      await proposeCategoriesFromHints(tx, { actor: agentActor("maintenance"), now: NOW });
      const [p] = await mine();
      expect(p).toMatchObject({ approvalStatus: "pending", entityType: "category" });
      expect((p.after as { events: number }).events).toBe(15);
      expect(await mine()).toHaveLength(1);
    });
  });
});

describe("events free basis", () => {
  it("requires a basis exactly when the event is free", async () => {
    await inRollback(async (tx) => {
      const [cat] = await tx.select().from(categories).limit(1);
      const [venue] = await tx.select().from(venues).limit(1);
      const base = { title: "T", normalizedTitle: "t", startAt: NOW, venueId: venue.id, categoryId: cat.id };
      const attempt = async (v: Partial<typeof events.$inferInsert>) => {
        try {
          await tx.transaction(async (sp) => {
            await sp.insert(events).values({ ...base, slug: `fb-${randomUUID()}`, ...v });
          });
          return "ok";
        } catch (err) {
          return (err as { cause?: { constraint_name?: string } }).cause?.constraint_name;
        }
      };
      expect(await attempt({ isFree: true })).toBe("events_free_basis_check");
      expect(await attempt({ isFree: false, freeBasis: "stated" })).toBe("events_free_basis_check");
      expect(await attempt({ isFree: null, freeBasis: "source_default" })).toBe("events_free_basis_check");
      expect(await attempt({ isFree: true, freeBasis: "source_default" })).toBe("ok");
      expect(await attempt({})).toBe("ok");
    });
  });
});
