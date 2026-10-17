import { describe, expect, it } from "vitest";
import { demotionReason } from "@/lib/sources/demotion";
import { promotionCheck, suggestFilters } from "./by-source";

const base = { pending: 0, flagged: 0, conflicts: 0, approved: 0, rejected: 0, rejectedByKind: {}, filteredSkips: 0 };
const NOW = new Date("2026-11-01T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("promotion", () => {
  it("needs 14 days, 15 reviewed, 90% approved, and no wrong dates or venues; filtered items don't count", () => {
    expect(promotionCheck({ ...base, approved: 18, rejected: 6, rejectedByKind: { filtered: 5, other: 1 } }, days(15), NOW).ready).toBe(true);
    expect(promotionCheck({ ...base, approved: 18, rejected: 1 }, days(10), NOW).notes[0]).toMatch(/10 of 14 days/);
    expect(promotionCheck({ ...base, approved: 10, rejected: 0 }, days(20), NOW).notes[0]).toMatch(/10 of 15 events/);
    expect(promotionCheck({ ...base, approved: 16, rejected: 4 }, days(20), NOW).notes.join()).toMatch(/80% approved/);
    expect(promotionCheck({ ...base, approved: 30, rejected: 1, rejectedByKind: { wrong_date: 1 } }, days(20), NOW).notes.join()).toMatch(/wrong date or venue/);
  });
});

describe("demotion", () => {
  const w = { slug: "s", consecutiveFailures: 0, events: 10, rejectedOrHidden: 0, outsideCities: ["Rogers"] };
  it("demotes on 3 failures, over 20% rejected or hidden (5+ events), or an event outside the area", () => {
    expect(demotionReason(w)).toBeNull();
    expect(demotionReason({ ...w, consecutiveFailures: 3 })).toMatch(/failed 3 runs/);
    expect(demotionReason({ ...w, rejectedOrHidden: 3 })).toMatch(/3 of its 10/);
    expect(demotionReason({ ...w, events: 4, rejectedOrHidden: 2 })).toBeNull();
    expect(demotionReason({ ...w, outsideCities: ["Rogers", "Eureka Springs"] })).toMatch(/Eureka Springs/);
  });
});

describe("filter suggestions", () => {
  it("finds phrases shared by 3+ titles, not ones in every title or already filtered", () => {
    const titles = ["Adult League Basketball", "Adult League Volleyball", "Adult League Soccer", "Story Time", "Lego Club", "Story Time for Toddlers"];
    expect(suggestFilters(titles).map((s) => s.phrase)).toEqual(["adult league"]);
    expect(suggestFilters(titles, ["adult league"])).toEqual([]);
  });
});
