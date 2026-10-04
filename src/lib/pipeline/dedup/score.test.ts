import { describe, expect, it } from "vitest";
import { decideFromLlm, preDecide, scorePair, ticketmasterEventId, tokenSetRatio, trigramSimilarity } from "./score";

const side = (title: string, start = "2026-10-16T01:00:00Z", ticketUrl: string | null = null) => ({ title, startAt: new Date(start), ticketUrl, sourceUrl: null });

describe("trigramSimilarity", () => {
  it("matches pg_trgm on identical, unrelated, and close titles", () => {
    expect(trigramSimilarity("Ziggy Marley", "ziggy marley!")).toBe(1);
    expect(trigramSimilarity("Ziggy Marley", "Blood Drive")).toBe(0);
    // pg_trgm: similarity('word', 'words') = 4/7 ≈ 0.571
    expect(trigramSimilarity("word", "words")).toBeCloseTo(4 / 7, 3);
  });
});

describe("tokenSetRatio", () => {
  it("weighs shared words over extra words and word order", () => {
    expect(tokenSetRatio("Ziggy Marley", "Ziggy Marley: Live in Concert")).toBe(1);
    expect(tokenSetRatio("Marley Ziggy", "Ziggy Marley")).toBe(1);
    expect(tokenSetRatio("Blood Drive", "Book Club")).toBe(0);
    // One shared word isn't a match: below T_merge, so the tiebreak decides.
    expect(tokenSetRatio("Harvest Market", "Harvest Dance")).toBeCloseTo(7 / 12, 3);
    expect(tokenSetRatio("Harvest Market", "Harvest Dance")).toBeLessThan(0.85);
  });
});

describe("ticketmasterEventId", () => {
  it("reads the ID from ticketmaster.com event links only", () => {
    expect(ticketmasterEventId("https://www.ticketmaster.com/ziggy-marley-tickets/event/0C00630FD8A54C2E")).toBe("0C00630FD8A54C2E");
    expect(ticketmasterEventId("https://evil.example/event/0C00630FD8A54C2E")).toBeNull();
    expect(ticketmasterEventId(null)).toBeNull();
  });
});

describe("scorePair and preDecide", () => {
  it("auto-merges the same show from two sources at the same time", () => {
    const s = scorePair(side("Ziggy Marley"), side("Ziggy Marley - One Love Tour", "2026-10-16T01:00:00Z"));
    expect(s.score).toBeGreaterThanOrEqual(0.85);
    expect(preDecide(s)).toBe("auto_merge");
  });

  it("sends same-title showings more than 30 minutes apart to the tiebreak, not a merge", () => {
    const s = scorePair(side("Ghost Walks", "2026-10-30T00:00:00Z"), side("Ghost Walks", "2026-10-30T01:00:00Z"));
    expect(s).toMatchObject({ score: 1, startDiffMinutes: 60 });
    expect(preDecide(s)).toBe("llm");
  });

  it("never auto-merges the same title at once in two different rooms; the tiebreak sees both", () => {
    const room = (r: string | null) => ({ ...side("Yoga @ FPL"), subSpace: r });
    const s = scorePair(room("Art & Movement Room (2nd Floor)"), room("Event Center (1st Floor)"));
    expect(s).toMatchObject({ score: 1, startDiffMinutes: 0, subSpaceDiffers: true });
    expect(preDecide(s)).toBe("llm");
    // One room unnamed, or the same room spelled the same: not a difference.
    expect(preDecide(scorePair(room("Event Center (1st Floor)"), room(null)))).toBe("auto_merge");
    expect(preDecide(scorePair(room("Event Center (1st Floor)"), room("event center (1st floor)")))).toBe("auto_merge");
  });

  it("treats a matching Ticketmaster event ID as certain, whatever the titles", () => {
    const url = "https://www.ticketmaster.com/x/event/ABC123";
    const s = scorePair(side("Razorbacks vs. LSU", "2026-11-28T18:00:00Z", url), side("Football: Arkansas hosts LSU", "2026-11-28T21:00:00Z", url));
    expect(s).toMatchObject({ ticketmasterIdMatch: true, score: 1 });
    expect(preDecide(s)).toBe("auto_merge");
  });

  it("calls unrelated titles distinct and middling ones a tiebreak", () => {
    expect(preDecide(scorePair(side("Blood Drive"), side("Toddler Time")))).toBe("distinct");
    expect(preDecide({ score: 0.6, startDiffMinutes: 0, ticketmasterIdMatch: false })).toBe("llm");
    expect(preDecide({ score: 0.49, startDiffMinutes: 0, ticketmasterIdMatch: false })).toBe("distinct");
  });
});

describe("decideFromLlm", () => {
  it("merges only a confident 'same'; a hesitant 'same' is uncertain", () => {
    expect(decideFromLlm({ same: true, confidence: 0.9 })).toBe("llm_same");
    expect(decideFromLlm({ same: true, confidence: 0.79 })).toBe("uncertain");
    expect(decideFromLlm({ same: false, confidence: 0.95 })).toBe("distinct");
  });
});
