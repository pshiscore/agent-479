import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { DbTx } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import { agentActions, rawRecords, runs, sources } from "@/lib/db/schema";
import { claimJob } from "@/lib/jobs";
import { dueSources, fetchSource, SourceDisabledError } from "@/lib/pipeline/fetch";
import { PoliteClient } from "@/lib/sources/http";
import { inRollback } from "./helpers";

afterAll(async () => {
  await getDb().$client.end({ timeout: 5 });
});

const tag = randomUUID().slice(0, 8);
const FEED = `https://feed-${tag}.example/events.ics`;
const NOW = new Date("2026-10-03T15:00:00Z");

const ics = (...events: [string, string][]) =>
  [
    "BEGIN:VCALENDAR",
    ...events.map(([uid, title]) => `BEGIN:VEVENT\nUID:${uid}\nSUMMARY:${title}\nDTSTART:20261010T190000\nDESCRIPTION:internal only\nEND:VEVENT`),
    "END:VCALENDAR",
  ].join("\n");

/** A PoliteClient over a fake web where the feed returns `body()` (or a status). */
function fakeHttp(body: () => Response) {
  const f = vi.fn(async (url: string | URL) =>
    String(url).endsWith("/robots.txt") ? new Response("", { status: 404 }) : body(),
  );
  const http = new PoliteClient({ fetch: f as unknown as typeof fetch, userAgent: "Agent479Bot (contact: t@example.org)", minGapMs: 0 });
  return { http, f };
}

async function addSource(tx: DbTx, over: Partial<typeof sources.$inferInsert> = {}) {
  const [s] = await tx
    .insert(sources)
    .values({
      slug: `fetch-test-${tag}-${randomUUID().slice(0, 4)}`,
      name: "Fetch test",
      kind: "ics",
      fetcher: "ics",
      baseUrl: `https://feed-${tag}.example/`,
      config: { feedUrl: FEED },
      trustLevel: 3,
      enabled: true,
      disabledReason: null,
      fetchIntervalMinutes: 60,
      termsNotes: "test",
      ...over,
    })
    .returning();
  return s;
}

describe("fetchSource", () => {
  it("refuses a disabled source without making any request", async () => {
    await inRollback(async (tx) => {
      const s = await addSource(tx, { enabled: false, disabledReason: "untested" });
      const { http, f } = fakeHttp(() => new Response(ics(["a", "A"])));
      await expect(fetchSource(tx, s.id, { http, now: NOW })).rejects.toBeInstanceOf(SourceDisabledError);
      expect(f).not.toHaveBeenCalled();
    });
  });

  it("writes raw_records, then tells unchanged from changed on the next fetch", async () => {
    await inRollback(async (tx) => {
      const s = await addSource(tx);
      let body = ics(["a@x", "Concert"], ["b@x", "Movie"]);
      const { http } = fakeHttp(() => new Response(body));

      const first = await fetchSource(tx, s.id, { http, now: NOW });
      expect(first).toMatchObject({ ok: true, stats: { items: 2, inserted: 2, changed: 0, unchanged: 0 } });
      const rows = await tx.select().from(rawRecords).where(eq(rawRecords.sourceId, s.id));
      expect(rows.map((r) => r.status)).toEqual(["pending", "pending"]);
      // Descriptions are stored internally, outside the payload, with a purge date.
      expect(JSON.stringify(rows.map((r) => r.payload))).not.toContain("internal only");
      expect(rows.map((r) => r.descriptionText)).toEqual(["internal only", "internal only"]);
      expect(rows[0].descriptionPurgeAfter?.toISOString()).toBe("2026-11-10T00:00:00.000Z");
      // Every row carries the run that wrote it.
      const [run] = await tx.select().from(runs).where(eq(runs.sourceId, s.id));
      expect(rows.every((r) => r.runId === run.id)).toBe(true);

      // Mark both processed (a valid processed state); then the source changes one.
      await tx.update(rawRecords).set({ status: "skipped", skipReason: "test" }).where(eq(rawRecords.sourceId, s.id));
      body = ics(["a@x", "Concert"], ["b@x", "Movie (moved)"]);
      const later = new Date(NOW.getTime() + 3_600_000);
      const second = await fetchSource(tx, s.id, { http, now: later });
      expect(second).toMatchObject({ ok: true, stats: { inserted: 0, changed: 1, unchanged: 1 } });
      const after = await tx.select().from(rawRecords).where(eq(rawRecords.sourceId, s.id));
      const byId = Object.fromEntries(after.map((r) => [r.externalId, r]));
      expect(byId["a@x"]).toMatchObject({ status: "skipped", fetchedAt: later });
      expect(byId["b@x"].status).toBe("pending");

      const [src] = await tx.select().from(sources).where(eq(sources.id, s.id));
      expect(src).toMatchObject({ enabled: true, consecutiveFailures: 0, lastError: null, lastSuccessAt: later });
    });
  });

  it("disables the source on a block, with a logged disable action", async () => {
    await inRollback(async (tx) => {
      const s = await addSource(tx);
      const { http, f } = fakeHttp(() => new Response("", { status: 403 }));
      const outcome = await fetchSource(tx, s.id, { http, now: NOW });
      expect(outcome).toMatchObject({ ok: false, disabled: true, error: expect.stringMatching(/HTTP 403/) });
      expect(f).toHaveBeenCalledTimes(2); // robots.txt, then the feed once: no retry

      const [src] = await tx.select().from(sources).where(eq(sources.id, s.id));
      expect(src).toMatchObject({ enabled: false, disabledReason: "blocked", consecutiveFailures: 1 });
      const [action] = await tx
        .select()
        .from(agentActions)
        .where(and(eq(agentActions.entityId, s.id), eq(agentActions.action, "disable")));
      expect(action).toMatchObject({ actor: "agent:fetch", entityType: "source" });
      expect(action.reason).toMatch(/A block means stop/);
      expect((action.before as { enabled: boolean }).enabled).toBe(true);
    });
  });

  it("disables a source configured with an unpermitted domain before anything is sent", async () => {
    await inRollback(async (tx) => {
      const s = await addSource(tx, { config: { feedUrl: "https://crystalbridges.org/events.ics" } });
      const { http, f } = fakeHttp(() => new Response(ics()));
      const outcome = await fetchSource(tx, s.id, { http, now: NOW });
      expect(outcome).toMatchObject({ ok: false, disabled: true });
      expect(f).not.toHaveBeenCalled();
    });
  });

  it("records ordinary failures and keeps the source enabled", async () => {
    await inRollback(async (tx) => {
      const s = await addSource(tx);
      const { http } = fakeHttp(() => new Response("", { status: 500 }));
      const outcome = await fetchSource(tx, s.id, { http, now: NOW });
      expect(outcome).toMatchObject({ ok: false, error: expect.stringMatching(/HTTP 500/) });
      const [src] = await tx.select().from(sources).where(eq(sources.id, s.id));
      expect(src).toMatchObject({ enabled: true, consecutiveFailures: 1, lastFetchedAt: NOW });
      const [run] = await tx.select().from(runs).where(eq(runs.sourceId, s.id));
      expect(run).toMatchObject({ job: "fetch", status: "failed" });
    });
  });
});

describe("dueSources", () => {
  it("returns enabled sources whose interval has passed", async () => {
    await inRollback(async (tx) => {
      const fresh = await addSource(tx, { lastFetchedAt: new Date(NOW.getTime() - 30 * 60_000) });
      const stale = await addSource(tx, { lastFetchedAt: new Date(NOW.getTime() - 61 * 60_000) });
      const never = await addSource(tx);
      const off = await addSource(tx, { enabled: false, disabledReason: "manual" });
      const ids = (await dueSources(tx, NOW)).map((s) => s.id);
      expect(ids).toEqual(expect.arrayContaining([stale.id, never.id]));
      expect(ids).not.toContain(fresh.id);
      expect(ids).not.toContain(off.id);
    });
  });
});

describe("claimJob", () => {
  it("lets one claim hold until it finishes or goes stale", async () => {
    await inRollback(async (tx) => {
      // Clear any real claim so the test starts from a known state.
      await tx.update(runs).set({ status: "failed" }).where(and(eq(runs.job, "manual"), eq(runs.status, "running")));
      const first = await claimJob(tx, "manual", { now: NOW });
      expect(first).not.toBeNull();
      expect(await claimJob(tx, "manual", { now: new Date(NOW.getTime() + 60_000) })).toBeNull();
      const later = await claimJob(tx, "manual", { now: new Date(NOW.getTime() + 16 * 60_000) });
      expect(later).not.toBeNull();
      const [old] = await tx.select().from(runs).where(eq(runs.id, first!.id));
      expect(old).toMatchObject({ status: "failed", error: expect.stringMatching(/stale/) });
    });
  });
});
