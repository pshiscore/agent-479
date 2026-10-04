import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { GenerateRequest } from "@/lib/llm";
import type { Facts } from "../map";
import { CODE_SET_TAGS, classificationSchema, classifyEvent } from "./classify";
import { describeEvent } from "./describe";
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
    const m = fakeModel({ extract: { isFree: true, priceMin: 10, priceMax: 5, ageRestriction: null, familyFriendly: null, registrationRequired: null, ageMin: null, ageMax: null, gradeMin: null, gradeMax: null } });
    const r = await extractFacts(m.generate, FACTS, "Tickets $10.");
    expect(r.data).toMatchObject({ isFree: false, priceMin: 10, priceMax: 10 });
  });
});

describe("describe", () => {
  const facts = { title: "Story Time", when: "Tuesday, October 13, 9:30 AM", venue: "Fayetteville Public Library", city: "Fayetteville", category: "Family & Kids", price: "Free", performers: [], tags: ["Free"], registrationRequired: null, ageMin: null, ageMax: null, gradeMin: null, gradeMax: null };
  const SOURCE = "Join us for songs rhymes and picture books with our friendly librarians every week in the story room";

  it("accepts original wording on the first try, and never shows the model the source text", async () => {
    const m = fakeModel({ describe: { description: "A free story hour with songs and books for preschoolers at the library." } });
    const r = await describeEvent(m.generate, facts, SOURCE);
    expect(r).toMatchObject({ status: "ok", attempts: 1 });
    expect(m.calls[0].input).not.toContain("librarians");
    expect(m.calls[0].input).toContain("Story Time");
  });

  it("retries once, then holds a description that keeps copying the source", async () => {
    const copied = "Join us for songs rhymes and picture books with our friendly librarians every week.";
    const m = fakeModel({ describe: [{ description: copied }, { description: copied }] });
    const r = await describeEvent(m.generate, facts, SOURCE);
    expect(r).toMatchObject({ status: "held", attempts: 2 });
    expect(m.calls[1].system).toMatch(/entirely in your own words/);
  });

  it("succeeds on the retry when the second draft is original", async () => {
    const m = fakeModel({ describe: [{ description: "Join us for songs rhymes and picture books with our friendly librarians each week." }, { description: "Preschoolers and caregivers share stories and songs at the library." }] });
    expect(await describeEvent(m.generate, facts, SOURCE)).toMatchObject({ status: "ok", attempts: 2 });
  });
});

describe("injection fixtures: code-level controls hold even if the model obeys", () => {
  const { cases } = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/injection/listings.json"), "utf8")) as {
    cases: { id: string; title: string; venueName: string; venueType: string; description: string }[];
  };

  it.each(cases.map((c) => [c.id, c] as const))("%s: the listing reaches the model only inside the untrusted block", async (_id, c) => {
    const m = fakeModel({
      extract: { isFree: null, priceMin: null, priceMax: null, ageRestriction: null, familyFriendly: null, registrationRequired: null, ageMin: null, ageMax: null, gradeMin: null, gradeMax: null },
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
    const m = fakeModel({ extract: { isFree: false, priceMin: 5, priceMax: 5, ageRestriction: null, familyFriendly: null, registrationRequired: null, ageMin: null, ageMax: null, gradeMin: null, gradeMax: null, ticketUrl: "https://evil.example" } });
    const r = await extractFacts(m.generate, FACTS, "x");
    expect(JSON.stringify(r.data)).not.toContain("evil.example");
  });
});
