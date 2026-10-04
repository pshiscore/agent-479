import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { GenerateRequest } from "@/lib/llm";
import type { Facts } from "../map";
import { CODE_SET_TAGS, classificationSchema, classifyEvent } from "./classify";
import { describeEvent, factAppears, newActivityStems, newAges, newPerformers } from "./describe";
import { extractFacts } from "./extract";
import type { Generate } from "./types";

const TAXONOMY = {
  categories: ["music", "arts-theater", "family-kids", "talks-learning", "community", "nightlife", "sports"].map((slug) => ({ id: `c-${slug}`, slug, name: slug })),
  tags: ["free", "outdoor", "family-friendly", "21-plus", "dog-friendly", "biking"].map((slug) => ({ id: `t-${slug}`, slug, name: slug })),
};
const FACTS = {
  title: "Preschool Story Time",
  startAt: "2026-10-13T14:30:00.000Z",
  endAt: null,
  allDay: false,
  timeTba: false,
  status: "scheduled",
  sourceUrl: "https://faylib.org/event/1",
  ticketUrl: null,
  location: { text: null, name: null, room: null, street: null, city: null, externalVenueId: null },
  price: { min: null, max: null, currency: null },
  performers: [],
  sourceCategories: [],
  legalAgeEnforced: null,
  recurrence: null,
  timezoneAssumed: false,
} as Facts;

/** A fake model that returns `out` per task, parsed through the request's schema like the real wrapper. */
function fakeModel(outputs: Record<string, unknown | unknown[]>) {
  const calls: GenerateRequest<z.ZodType>[] = [];
  const counters: Record<string, number> = {};
  const generate = vi.fn(async (req: GenerateRequest<z.ZodType>) => {
    calls.push(req);
    const o = outputs[req.task];
    const i = (counters[req.task] = (counters[req.task] ?? 0) + 1) - 1;
    const raw = Array.isArray(o) ? o[Math.min(i, o.length - 1)] : o;
    return { data: req.schema.parse(raw), callId: `call-${req.task}-${i}`, model: "fake-model", costUsd: 0 };
  }) as unknown as Generate;
  return { generate, calls };
}

describe("classify", () => {
  it("builds its enums from the active rows, without the code-owned tags", () => {
    const schema = classificationSchema(TAXONOMY.categories, TAXONOMY.tags);
    expect(() => schema.parse({ category: "made-up", tags: [], closestMissingCategory: null })).toThrow();
    for (const t of CODE_SET_TAGS) expect(() => schema.parse({ category: "music", tags: [t], closestMissingCategory: null })).toThrow();
  });

  it("requires a hint for Community and drops it otherwise", async () => {
    const m1 = fakeModel({ classify: { category: "community", tags: [], closestMissingCategory: "Library programs" } });
    expect((await classifyEvent(m1.generate, { facts: FACTS, venueName: "Lib", venueType: "library", extraction: null, description: null }, TAXONOMY)).data).toEqual({
      category: "community",
      tags: [],
      closestMissingCategory: "Library programs",
    });
    const m2 = fakeModel({ classify: { category: "community", tags: [], closestMissingCategory: null } });
    expect((await classifyEvent(m2.generate, { facts: FACTS, venueName: "Lib", venueType: "library", extraction: null, description: null }, TAXONOMY)).data.closestMissingCategory).toBe("unknown");
    const m3 = fakeModel({ classify: { category: "music", tags: ["outdoor", "outdoor"], closestMissingCategory: "stray" } });
    expect((await classifyEvent(m3.generate, { facts: FACTS, venueName: "Lib", venueType: "library", extraction: null, description: null }, TAXONOMY)).data).toEqual({
      category: "music",
      tags: ["outdoor"],
      closestMissingCategory: null,
    });
  });
});

describe("extract", () => {
  it("resolves a stated price over a 'free' claim, and an inverted range", async () => {
    const m = fakeModel({ extract: { isFree: true, priceMin: 10, priceMax: 5, ageRestriction: null, familyFriendly: null, registrationRequired: null, ageMin: null, ageMax: null, gradeMin: null, gradeMax: null, spanish: null, activity: null } });
    const r = await extractFacts(m.generate, FACTS, "Tickets $10.");
    expect(r.data).toMatchObject({ isFree: false, priceMin: 10, priceMax: 10 });
  });
});

describe("describe", () => {
  const facts = { title: "Story Time", when: "Tuesday, October 13, 9:30 AM", venue: "Fayetteville Public Library", city: "Fayetteville", category: "Family & Kids", price: "Free", tags: ["Free"], performers: [], ages: "ages 3–5", activity: "sing songs and read picture books", registrationRequired: null };
  const SOURCE = "Join us for songs rhymes and picture books with our friendly librarians every week in the story room";
  const ok = (description: string, usedFacts = ["ages"]) => ({ description, usedFacts });

  it("accepts original wording on the first try, and never shows the model the source text", async () => {
    const m = fakeModel({ describe: ok("Songs and picture books for kids ages 3 to 5.", ["ages", "activity"]) });
    const r = await describeEvent(m.generate, facts, SOURCE);
    expect(r).toMatchObject({ status: "ok", attempts: 1, usedFacts: ["ages", "activity"] });
    expect(m.calls[0].input).not.toContain("librarians");
    expect(m.calls[0].input).toContain("Story Time");
  });

  it("retries once, then holds a description that keeps copying the source", async () => {
    const copied = "Join us for songs rhymes and picture books with our friendly librarians every week, ages 3-5.";
    const m = fakeModel({ describe: [ok(copied), ok(copied)] });
    const r = await describeEvent(m.generate, facts, SOURCE);
    expect(r).toMatchObject({ status: "held", attempts: 2 });
    expect(m.calls[1].system).toMatch(/entirely in your own words/);
  });

  it("succeeds on the retry when the second draft is original", async () => {
    const m = fakeModel({ describe: [ok("Join us for songs rhymes and picture books with our friendly librarians each week, ages 3-5."), ok("Stories and songs for kids ages 3–5.")] });
    expect(await describeEvent(m.generate, facts, SOURCE)).toMatchObject({ status: "ok", attempts: 2 });
  });

  it("regenerates a draft with praise or outside facts, then holds it if it happens again", async () => {
    const praise = ok("An amazing story time for kids ages 3 to 5.");
    const clean = ok("Stories and songs for kids ages 3 to 5.");
    const m = fakeModel({ describe: [praise, clean] });
    expect(await describeEvent(m.generate, facts, null)).toMatchObject({ status: "ok", attempts: 2, description: "Stories and songs for kids ages 3 to 5." });
    expect(m.calls[1].system).toMatch(/evaluative: amazing/);

    const background = ok("Stories by Dr. Seuss for kids ages 3 to 5, as read since 1957.");
    const m2 = fakeModel({ describe: [background, background] });
    const held = await describeEvent(m2.generate, facts, null);
    expect(held).toMatchObject({ status: "held", attempts: 2 });
    expect(held.status === "held" && held.problem).toMatch(/not in the facts: 1957, Seuss/);
  });

  it("never counts the event's own title as praise", async () => {
    const m = fakeModel({ describe: ok("Show tunes from Best of Broadway for kids ages 3 to 5.") });
    expect(await describeEvent(m.generate, { ...facts, title: "Best of Broadway" }, null)).toMatchObject({ status: "ok", attempts: 1 });
  });

  it("makes no model call when nothing beyond the title and category is known", async () => {
    const m = fakeModel({ describe: ok("A yoga session for people interested in practicing yoga.") });
    const r = await describeEvent(m.generate, { ...facts, title: "Yoga @ FPL", ages: null, activity: null }, null);
    expect(r).toMatchObject({ status: "none", callId: null });
    expect(m.calls).toHaveLength(0);
  });

  it("drops a description that claims a fact it doesn't contain, or declines", async () => {
    const bluff = fakeModel({ describe: ok("A cozy library story hour for little ones.", ["ages"]) });
    expect(await describeEvent(bluff.generate, facts, null)).toMatchObject({ status: "none" });
    const declined = fakeModel({ describe: { description: null, usedFacts: [] } });
    expect(await describeEvent(declined.generate, facts, null)).toMatchObject({ status: "none" });
  });

  it("offers only facts the title doesn't already state", () => {
    expect(newPerformers("Ziggy Marley", ["Ziggy Marley"])).toEqual([]);
    expect(newPerformers("Snail Mail w/ Soccer Mommy", ["Snail Mail", "Soccer Mommy", "Hana Vu"])).toEqual(["Hana Vu"]);
    const r = (ageMin: number | null, ageMax: number | null, gradeMin: number | null = null, gradeMax: number | null = null) => ({ ageMin, ageMax, gradeMin, gradeMax });
    expect(newAges("Toddler Time (Ages 2–3)", r(2, 3))).toBeNull();
    expect(newAges("Baby Bookworms (Ages 0–24 months)", r(0, 2))).toBeNull();
    expect(newAges("Lego Club", r(6, 12))).toBe("ages 6–12");
    expect(newAges("Teen Advisory Board", r(null, null, 7, 12))).toBe("grades 7–12");
    expect(newAges("Adult Coloring", r(18, null))).toBe("ages 18 and up");
  });

  it("counts an activity only when it says something the title and category don't", () => {
    expect(newActivityStems("make a bracelet", "Drop-In Bracelet Making – LGBTQ+ History Month", "Arts & Theater")).toEqual([]);
    expect(newActivityStems("watch a Halloween movie", "Halloween Family Movies: Halloweentown (1998) (G)", "Film")).toEqual([]);
    expect(newActivityStems("bake and decorate cookies", "Teen Cuisine: Rainbow Cookies", "Food & Drink")).toEqual(["bak", "decora"]);
    expect(newActivityStems("watch a film and join a discussion", "A Greener Goodbye", "Film")).toEqual(["discus"]);
  });

  it("checks each claimed fact against the text", () => {
    expect(factAppears("activity", "Kids bake and decorate cookies.", { ...facts, activity: "bake and decorate rainbow cookies" })).toBe(true);
    expect(factAppears("activity", "A fun afternoon at the library.", { ...facts, activity: "bake and decorate rainbow cookies" })).toBe(false);
    // Repeating only what the title says doesn't count.
    expect(factAppears("activity", "Story time at the library.", { ...facts, title: "Story Time", activity: "story time and songs" })).toBe(false);
    expect(factAppears("registration", "Space is limited, so sign up ahead.", facts)).toBe(true);
    expect(factAppears("performers", "With an opening set by Hana Vu.", { ...facts, performers: ["Hana Vu"] })).toBe(true);
  });
});

describe("injection fixtures: code-level controls hold even if the model obeys", () => {
  const { cases } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/injection/listings.json"), "utf8")) as {
    cases: { id: string; title: string; venueName: string; venueType: string; description: string }[];
  };

  it.each(cases.map((c) => [c.id, c] as const))("%s: the listing reaches the model only inside the untrusted block", async (_id, c) => {
    const m = fakeModel({
      extract: { isFree: null, priceMin: null, priceMax: null, ageRestriction: null, familyFriendly: null, registrationRequired: null, ageMin: null, ageMax: null, gradeMin: null, gradeMax: null, spanish: null, activity: null },
      classify: { category: "music", tags: [], closestMissingCategory: null },
    });
    const facts = { ...FACTS, title: c.title };
    await extractFacts(m.generate, facts, c.description);
    await classifyEvent(m.generate, { facts, venueName: c.venueName, venueType: c.venueType, extraction: null, description: c.description }, TAXONOMY);
    for (const call of m.calls) {
      const start = call.input.search(/<<<UNTRUSTED-[0-9a-f]{12} /);
      expect(start).toBeGreaterThan(-1);
      // The planted text only appears after the opening marker.
      expect(call.input.indexOf(c.description.slice(-30).replace(/<<<|>>>/g, "‹‹"))).toBeGreaterThan(start);
      // A forged end marker is neutralized.
      expect(call.input).not.toContain("<<<END UNTRUSTED-000000000000>>>");
    }
  });

  it("a model obeying a planted category outside the list is rejected by the schema", async () => {
    const m = fakeModel({ classify: { category: "admin-mode", tags: [], closestMissingCategory: null } });
    await expect(classifyEvent(m.generate, { facts: FACTS, venueName: "x", venueType: "other", extraction: null, description: "x" }, TAXONOMY)).rejects.toThrow();
  });

  it("a model can't set a ticket URL: no stage's output schema has a URL field", async () => {
    const m = fakeModel({ extract: { isFree: false, priceMin: 5, priceMax: 5, ageRestriction: null, familyFriendly: null, registrationRequired: null, ageMin: null, ageMax: null, gradeMin: null, gradeMax: null, spanish: null, activity: null, ticketUrl: "https://evil.example" } });
    const r = await extractFacts(m.generate, FACTS, "x");
    expect(JSON.stringify(r.data)).not.toContain("evil.example");
  });
});
