import { describe, expect, it, vi } from "vitest";
import { SourceStateError } from "./admin";
import { PoliteClient } from "./http";
import { summarize, testFetch } from "./test-fetch";
import type { FetchResult, SourceRow } from "./types";

const item = (uid: string, start: string | null, extra: Record<string, unknown> = {}) => ({
  externalId: uid,
  sourceUrl: null,
  descriptionText: null,
  descriptionPurgeAfter: null,
  payload: { event: { uid, summary: `Event ${uid}`, dtstart: start ? { value: start, isDate: false } : null, ...extra } },
});
const result = (items: ReturnType<typeof item>[]): FetchResult => ({ items, feedUrls: ["https://x.example/f.ics"], stats: {} });
// 2026-10-03 10:00 in Chicago.
const TODAY = new Date("2026-10-03T15:00:00Z");

describe("summarize", () => {
  it("passes a feed with upcoming events and reports its range", () => {
    const r = summarize("s", result([item("a", "20261001T100000"), item("b", "20261010T190000"), item("c", "20261102T190000", { location: "Library" })]), TODAY);
    expect(r).toMatchObject({ pass: true, items: 3, upcoming: 2, firstDate: "2026-10-01", lastDate: "2026-11-02", daysAhead: 30, withLocation: 1 });
    expect(r.sample.map((s) => s.title)).toEqual(["Event b", "Event c"]);
  });

  it("counts a recurring event with a past start as upcoming", () => {
    expect(summarize("s", result([item("a", "20260105T100000", { rrule: "FREQ=WEEKLY" })]), TODAY)).toMatchObject({ pass: true, upcoming: 1, recurring: 1 });
  });

  it("fails empty feeds, past-only feeds, and events with no start", () => {
    expect(summarize("s", result([]), TODAY).problems).toEqual(["the feed has no events"]);
    expect(summarize("s", result([item("a", "20250101T100000")]), TODAY).problems).toEqual(["no events today or later"]);
    expect(summarize("s", result([item("a", "20261010T100000"), item("b", null)]), TODAY).problems).toEqual(["1 events have no usable start"]);
  });
});

describe("testFetch gate", () => {
  const row = (over: Partial<SourceRow>) =>
    ({
      slug: "gate-test",
      kind: "ics",
      fetcher: "ics",
      baseUrl: "https://feed.example/",
      config: { feedUrl: "https://feed.example/events.ics" },
      enabled: false,
      disabledReason: "untested",
      ...over,
    }) as SourceRow;

  function countingClient() {
    const f = vi.fn(async () => new Response("", { status: 404 }));
    return { f, http: new PoliteClient({ fetch: f as unknown as typeof fetch, userAgent: "Agent479Bot (contact: t@example.org)", minGapMs: 0 }) };
  }

  it.each([
    ["awaiting permission", { disabledReason: "awaiting_permission" as const }],
    ["blocked", { disabledReason: "blocked" as const }],
    ["manually disabled", { disabledReason: "manual" as const }],
    ["already enabled", { enabled: true, disabledReason: null }],
  ])("refuses a source that is %s, without sending a request", async (_label, over) => {
    const { f, http } = countingClient();
    await expect(testFetch(row(over), http, TODAY)).rejects.toBeInstanceOf(SourceStateError);
    expect(f).not.toHaveBeenCalled();
  });

  it("lets an untested source through to its fetcher", async () => {
    const { f, http } = countingClient();
    // The fake web 404s, so the fetch fails, but only after the gate let it run.
    await expect(testFetch(row({}), http, TODAY)).rejects.toThrow(/HTTP 404/);
    expect(f).toHaveBeenCalled();
  });
});
