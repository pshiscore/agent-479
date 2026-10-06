import { describe, expect, it } from "vitest";
import { type EventItem, foldRecurring, weekendVariety } from "./queries";

let n = 0;
const ev = (over: Partial<EventItem> = {}): EventItem => ({
  id: `e${++n}`, slug: `e${n}`, title: `Event ${n}`, startAt: new Date(Date.UTC(2026, 9, 9, n)), endAt: null, allDay: false, timeTba: false,
  venue: { slug: "v1", name: "V1", type: "theater" }, subSpace: null, city: { slug: "fayetteville", name: "Fayetteville" },
  category: { slug: "music", name: "Music" }, tags: [], shortDescription: null, ageMin: null, ageMax: null, gradeMin: null, gradeMax: null,
  moreInfoUrl: null, ticketUrl: null, source: "city", series: null, days: [], parent: null, parts: [], ...over,
});

describe("foldRecurring", () => {
  it("folds recurring occurrences into one row per series, keeping runs and one-offs", () => {
    const s = { id: "s1", kind: "recurring", label: "Tuesdays", title: "Storytime" };
    const run = { id: "r1", kind: "run", label: "Oct 6–9", title: "A Play" };
    const items = [ev({ series: s }), ev(), ev({ series: s }), ev({ series: run })];
    const { events, series } = foldRecurring(items, false);
    expect(events).toHaveLength(2);
    expect(series).toEqual([expect.objectContaining({ id: "s1", label: "Tuesdays", occurrences: 2, next: items[0] })]);
    expect(foldRecurring(items, true)).toEqual({ events: items, series: [] });
  });
});

describe("weekendVariety", () => {
  it("caps each venue and the total, spreading categories", () => {
    const items = [
      ...Array.from({ length: 4 }, () => ev({ venue: { slug: "lib", name: "Library", type: "library" }, category: { slug: "talks", name: "Talks" } })),
      ev({ venue: { slug: "a", name: "A", type: "arena" }, category: { slug: "sports", name: "Sports" } }),
      ev({ venue: { slug: "b", name: "B", type: "theater" } }),
    ];
    const { shown, hidden } = weekendVariety(items, { perVenue: 2, total: 3 });
    expect(hidden).toBe(3);
    expect(new Set(shown.map((e) => e.category.slug))).toEqual(new Set(["talks", "sports", "music"]));
    expect(shown.map((e) => e.startAt.getTime())).toEqual([...shown.map((e) => e.startAt.getTime())].sort((a, b) => a - b));
  });
});
