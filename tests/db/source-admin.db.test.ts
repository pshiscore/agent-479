import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { agentActor, humanActor } from "@/lib/actions/record";
import { type DbTx, getDb } from "@/lib/db/client";
import { agentActions, rawRecords, runs, sources } from "@/lib/db/schema";
import { purgeDescriptions } from "@/lib/pipeline/maintenance";
import {
  blockedSources,
  disableManually,
  enableAfterTest,
  enableManually,
  recordPermission,
  SourceStateError,
  sourcesNeedingAttention,
} from "@/lib/sources/admin";
import type { TestFetchReport } from "@/lib/sources/test-fetch";
import { startRun } from "@/lib/runs";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const tag = randomUUID().slice(0, 8);
const OWNER = humanActor("owner");
const REASON = "Owner reviewed it and approved";

async function addSource(tx: DbTx, over: Partial<typeof sources.$inferInsert> = {}) {
  const [s] = await tx
    .insert(sources)
    .values({
      slug: `admin-${tag}-${randomUUID().slice(0, 4)}`,
      name: "Admin test",
      kind: "ics",
      fetcher: "ics",
      baseUrl: "https://feed.example/",
      trustLevel: 3,
      fetchIntervalMinutes: 60,
      termsNotes: "t",
      ...over,
    })
    .returning();
  return s;
}

const passing = (slug: string): TestFetchReport => ({
  slug,
  pass: true,
  problems: [],
  feedUrls: ["https://feed.example/x.ics"],
  items: 3,
  withStart: 3,
  recurring: 0,
  upcoming: 3,
  withLocation: 3,
  withUrl: 0,
  firstDate: "2026-10-04",
  lastDate: "2026-11-01",
  daysAhead: 29,
  sample: [],
  fetcherStats: {},
});

describe("source state rules", () => {
  it("enables an untested source only with a passing test, and logs it", async () => {
    await inRollback(async (tx) => {
      const s = await addSource(tx);
      await expect(enableAfterTest(tx, s.slug, { ...passing(s.slug), pass: false }, OWNER)).rejects.toThrow(SourceStateError);
      const after = await enableAfterTest(tx, s.slug, passing(s.slug), OWNER);
      expect(after).toMatchObject({ enabled: true, disabledReason: null });
      const [a] = await tx.select().from(agentActions).where(and(eq(agentActions.entityId, s.id), eq(agentActions.action, "enable")));
      expect(a.reason).toMatch(/Test fetch passed: 3 events/);
    });
  });

  it("never enables awaiting_permission or blocked sources through a test", async () => {
    await inRollback(async (tx) => {
      for (const disabledReason of ["awaiting_permission", "blocked", "manual"] as const) {
        const s = await addSource(tx, { disabledReason });
        await expect(enableAfterTest(tx, s.slug, passing(s.slug), OWNER)).rejects.toThrow(/only for untested/);
      }
    });
  });

  it("re-enables blocked or manual sources by hand only, with the owner's reason", async () => {
    await inRollback(async (tx) => {
      const blocked = await addSource(tx, { disabledReason: "blocked" });
      await expect(enableManually(tx, blocked.slug, "short", OWNER)).rejects.toThrow(/reason/);
      await expect(enableManually(tx, blocked.slug, REASON, agentActor("fetch"))).rejects.toThrow(/only a person/);
      const after = await enableManually(tx, blocked.slug, REASON, OWNER);
      expect(after).toMatchObject({ enabled: true, disabledReason: null });
      const [a] = await tx.select().from(agentActions).where(and(eq(agentActions.entityId, blocked.id), eq(agentActions.action, "enable")));
      expect(a).toMatchObject({ actor: "human:owner", reason: `Re-enabled by hand (was blocked): ${REASON}` });

      const untested = await addSource(tx);
      await expect(enableManually(tx, untested.slug, REASON, OWNER)).rejects.toThrow(/test fetch/);
      const waiting = await addSource(tx, { disabledReason: "awaiting_permission" });
      await expect(enableManually(tx, waiting.slug, REASON, OWNER)).rejects.toThrow(/permission/);
    });
  });

  it("records permission (awaiting → untested) and manual disables, all logged", async () => {
    await inRollback(async (tx) => {
      const waiting = await addSource(tx, { disabledReason: "awaiting_permission" });
      expect(await recordPermission(tx, waiting.slug, "Written permission from the museum, 2026-10-10", OWNER)).toMatchObject({
        enabled: false,
        disabledReason: "untested",
      });
      const on = await addSource(tx, { enabled: true, disabledReason: null });
      expect(await disableManually(tx, on.slug, "Feed is broken for now", OWNER)).toMatchObject({
        enabled: false,
        disabledReason: "manual",
      });
      const actions = await tx
        .select({ action: agentActions.action })
        .from(agentActions)
        .where(eq(agentActions.actor, "human:owner"));
      expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(["update", "disable"]));
    });
  });

  it("flags sources with 3+ consecutive failures without disabling them, and lists blocked ones with the reason", async () => {
    await inRollback(async (tx) => {
      const flaky = await addSource(tx, { enabled: true, disabledReason: null, consecutiveFailures: 3 });
      const fine = await addSource(tx, { enabled: true, disabledReason: null, consecutiveFailures: 2 });
      const ids = (await sourcesNeedingAttention(tx)).map((s) => s.id);
      expect(ids).toContain(flaky.id);
      expect(ids).not.toContain(fine.id);

      const blocked = await addSource(tx, { disabledReason: "blocked", lastError: "Blocked by x: HTTP 403" });
      await tx.insert(agentActions).values({
        actor: "agent:fetch",
        action: "disable",
        entityType: "source",
        entityId: blocked.id,
        before: { enabled: true },
        after: { enabled: false },
        reason: "Blocked by feed.example: HTTP 403. A block means stop.",
      });
      const listed = (await blockedSources(tx)).find((b) => b.source.id === blocked.id);
      expect(listed?.reason).toMatch(/HTTP 403/);
    });
  });
});

describe("purgeDescriptions", () => {
  it("clears descriptions past their purge date, or 30 days after last seen for open series", async () => {
    await inRollback(async (tx) => {
      const s = await addSource(tx);
      const run = await startRun(tx, "fetch", { sourceId: s.id });
      const now = new Date("2026-12-15T00:00:00Z");
      const row = (externalId: string, over: Partial<typeof rawRecords.$inferInsert>) => ({
        sourceId: s.id,
        runId: run.id,
        externalId,
        contentHash: "h",
        payload: {},
        descriptionText: `about ${externalId}`,
        ...over,
      });
      await tx.insert(rawRecords).values([
        row("past", { descriptionPurgeAfter: new Date("2026-12-01T00:00:00Z") }),
        row("future", { descriptionPurgeAfter: new Date("2027-01-01T00:00:00Z") }),
        row("open-stale", { descriptionPurgeAfter: null, fetchedAt: new Date("2026-11-01T00:00:00Z") }),
        row("open-fresh", { descriptionPurgeAfter: null, fetchedAt: new Date("2026-12-10T00:00:00Z") }),
      ]);
      expect(await purgeDescriptions(tx, now)).toBe(2);
      const left = await tx
        .select({ externalId: rawRecords.externalId, d: rawRecords.descriptionText })
        .from(rawRecords)
        .where(eq(rawRecords.sourceId, s.id));
      const byId = Object.fromEntries(left.map((r) => [r.externalId, r.d]));
      expect(byId).toEqual({ past: null, future: "about future", "open-stale": null, "open-fresh": "about open-fresh" });
    });
  });

  it("requires a run_id on every raw record", async () => {
    await inRollback(async (tx) => {
      const s = await addSource(tx);
      await expect(
        tx.transaction((sp) =>
          sp.insert(rawRecords).values({ sourceId: s.id, externalId: "x", contentHash: "h" } as typeof rawRecords.$inferInsert),
        ),
      ).rejects.toThrow();
      const [{ n }] = await tx.select({ n: runs.id }).from(runs).limit(1);
      expect(n).toBeTruthy();
    });
  });
});
