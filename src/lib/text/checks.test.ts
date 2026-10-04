import { describe, expect, it } from "vitest";
import { contentIssues, evaluativeTerms, groundedExpansions, ungrounded, unknownExpansions } from "./checks";

describe("evaluativeTerms", () => {
  it("flags evaluative words in our text, however hyphenated or apostrophized", () => {
    expect(evaluativeTerms("An amazing night you won't forget.", [])).toEqual(["amazing"]);
    expect(evaluativeTerms("A must see show. Don’t miss it!", [])).toEqual(["must-see", "don't miss"]);
    expect(evaluativeTerms("The world class orchestra plays Mozart.", [])).toEqual(["world-class"]);
  });
  it("never counts the event's own names, and matches whole words only", () => {
    expect(evaluativeTerms("Best of Broadway brings show tunes to the stage.", ["Best of Broadway"])).toEqual([]);
    expect(evaluativeTerms("The Iconic Band plays covers.", ["Iconic Band"])).toEqual([]);
    expect(evaluativeTerms("Bestselling author signs books.", [])).toEqual([]);
    expect(evaluativeTerms("A talk on the bestiary of medieval art.", [])).toEqual([]);
  });
});

describe("ungrounded", () => {
  const facts = "Ziggy Marley | Ozark Music Hall | Fayetteville | Music | Friday, October 16, 8:00 PM | performers: Ziggy Marley";
  it("passes names and numbers that are in the facts", () => {
    expect(ungrounded("Ziggy Marley performs at 8 p.m.", facts)).toEqual([]);
  });
  it("flags names and numbers the model brought from its own knowledge", () => {
    expect(ungrounded("The Grammy-winning Ziggy Marley, son of Bob Marley, plays songs from 1988.", facts)).toEqual(["1988", "Grammy-winning", "Bob"]);
  });
  // Known limit: a sentence-initial capitalized word ("Grammy-winning Ziggy...")
  // looks like any sentence opener, so only acronyms and mixed case are caught there.
  it("skips ordinary sentence-initial words but not acronyms there", () => {
    expect(ungrounded("Listen to stories and songs.", "Story Time")).toEqual([]);
    expect(ungrounded("NASA engineers lead the session.", "Rocket Club")).toEqual(["NASA"]);
    // "Dr." doesn't end the sentence, so "Seuss" is still caught.
    expect(ungrounded("Stories by Dr. Seuss.", "Story Time")).toEqual(["Seuss"]);
    expect(ungrounded("Learn to use a 3D printer.", "CFI Learning Lab: 3D Printing")).toEqual([]);
  });
});

describe("contentIssues", () => {
  it("is null for clean text and lists both kinds of problems otherwise", () => {
    expect(contentIssues("Stories and songs for kids ages 3 to 5.", { text: "Story Time | ages 3–5", ownNames: ["Story Time"] })).toBeNull();
    expect(contentIssues("An incredible night with the Rolling Stones.", { text: "Tribute Night", ownNames: ["Tribute Night"] })).toEqual({
      evaluative: ["incredible"],
      ungrounded: ["Rolling", "Stones"],
    });
  });
});

describe("glossary", () => {
  const esl = "ESL for Beginner, Intermediate & Advanced Levels *";
  it("grounds an expansion only when the acronym is in that event's facts", () => {
    expect(ungrounded("Learn English in a class suited to your level.", esl)).toEqual([]);
    expect(ungrounded("Attend an English as a Second Language class.", esl)).toEqual([]);
    expect(ungrounded("An English-language class.", esl)).toEqual([]);
    // No ESL in the facts: "English" is the model's own addition.
    expect(ungrounded("Sing along in English.", "Choir Practice")).toEqual(["English"]);
    // Lowercase "esl" in a URL or word isn't the acronym.
    expect(groundedExpansions("https://example.org/esl-class")).toEqual([]);
  });
  it("finds expansions the glossary doesn't have, for the owner to approve", () => {
    expect(unknownExpansions("Prepare for the Test of English as a Foreign Language exam.", "TOEFL Prep")).toEqual([
      { acronym: "TOEFL", expansion: "Test of English as a Foreign Language" },
    ]);
    expect(unknownExpansions("Attend an English as a Second Language class.", "ESL Class")).toEqual([]);
    expect(unknownExpansions("A class for everyone.", "TOEFL Prep")).toEqual([]);
    // Already grounded by the venue's name: nothing to propose.
    expect(unknownExpansions("Yoga at Fayetteville Public Library.", "Yoga @ FPL | Event Center, Fayetteville Public Library")).toEqual([]);
  });
});
