import { describe, expect, it } from "vitest";
import { overlaps, placeInView, spanDays } from "./multiday";
import type { EventItem } from "./queries";

let n = 0;
const at = (iso: string) => new Date(iso);
const ev = (over: Partial<EventItem> = {}): EventItem => ({
  id: `e${++n}`, slug: `e${n}`, title: `Event ${n}`, startAt: at("2026-10-16T13:00:00Z"), endAt: null, allDay: false, timeTba: false,
  venue: { slug: "v", name: "V", type: "park" }, subSpace: null, city: { slug: "rogers", name: "Rogers" }, category: { slug: "festivals-markets", name: "Festivals" },
  tags: [], shortDescription: null, ageMin: null, ageMax: null, gradeMin: null, gradeMax: null, moreInfoUrl: null, ticketUrl: null, source: "owner",
  series: null, days: [], ...over,
});

// War Eagle-style fair: Thu Oct 15 8 am to Sun Oct 18 5 pm (Chicago).
const fair = () => ev({ title: "Fair", startAt: at("2026-10-15T13:00:00Z"), endAt: at("2026-10-18T22:00:00Z") });
const SAT = at("2026-10-17T05:00:00Z"); // Saturday 00:00 Chicago

describe("multi-day events", () => {
  it("counts real multi-day spans, not a late show", () => {
    expect(spanDays(fair())).toBe(4);
    expect(spanDays(ev({ startAt: at("2026-10-17T01:00:00Z"), endAt: at("2026-10-17T06:00:00Z") }))).toBe(1); // 8 pm to 1 am
    expect(spanDays(ev({ startAt: at("2026-10-16T05:00:00Z"), endAt: at("2026-10-17T04:59:00Z"), allDay: true }))).toBe(1);
    expect(spanDays(ev({ startAt: at("2026-10-16T05:00:00Z"), endAt: at("2026-10-18T04:59:00Z"), allDay: true }))).toBe(2);
    expect(spanDays(ev({ startAt: at("2026-10-16T22:00:00Z"), endAt: at("2026-10-17T19:00:00Z"), days: [
      { day: "2026-10-16", opensAt: null, closesAt: null }, { day: "2026-10-17", opensAt: null, closesAt: null },
    ] }))).toBe(2); // 21 hours, but stated hours on two days
  });

  it("lists a running festival once, on the view's first day, as Day 3 of 4 with that day's hours", () => {
    const hours = { day: "2026-10-17", opensAt: at("2026-10-17T13:00:00Z"), closesAt: at("2026-10-17T22:00:00Z") };
    const f = { ...fair(), days: [hours] };
    expect(overlaps(f, SAT, at("2026-10-19T05:00:00Z"))).toBe(true);
    const { timeline, ongoing } = placeInView([f], SAT);
    expect(ongoing).toEqual([]);
    expect(timeline[0].placement).toEqual({ day: "2026-10-17", dayNumber: 3, dayCount: 4, hours: { opensAt: hours.opensAt, closesAt: hours.closesAt } });
    // Viewed from before it starts: its own first day, Day 1.
    expect(placeInView([fair()], at("2026-10-12T05:00:00Z")).timeline[0].placement).toMatchObject({ day: "2026-10-15", dayNumber: 1 });
  });

  it("puts runs of 8+ days in Ongoing, and leaves single-day events alone", () => {
    const lights = ev({ title: "Lights", startAt: at("2026-11-21T06:00:00Z"), endAt: at("2027-01-02T05:59:00Z"), allDay: true });
    const show = ev({ title: "Show", startAt: at("2026-12-05T02:00:00Z") });
    const { timeline, ongoing } = placeInView([lights, show], at("2026-12-04T06:00:00Z"));
    expect(ongoing.map((e) => e.title)).toEqual(["Lights"]);
    expect(timeline).toEqual([show]);
  });
});
