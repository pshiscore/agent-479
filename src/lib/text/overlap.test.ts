import { describe, expect, it } from "vitest";
import { checkOriginalWording, longestSharedRun } from "./overlap";

const SOURCE =
  "Join us on the historic downtown square for a free evening of live jazz under the stars, featuring local favorites.";

describe("longestSharedRun", () => {
  it("finds the longest run of shared consecutive words, ignoring case and punctuation", () => {
    expect(longestSharedRun("A FREE evening of live jazz!", SOURCE)).toEqual(["a", "free", "evening", "of", "live", "jazz"]);
    expect(longestSharedRun("nothing alike", SOURCE)).toEqual([]);
    expect(longestSharedRun("", SOURCE)).toEqual([]);
  });
});

describe("checkOriginalWording", () => {
  it("passes our own wording, and runs of up to 7 shared words", () => {
    expect(checkOriginalWording("Live jazz on the Bentonville Square Saturday night. Free.", SOURCE).ok).toBe(true);
    // 7 shared words: "the historic downtown square for a free".
    expect(checkOriginalWording("Meet at the historic downtown square for a free show.", SOURCE).ok).toBe(true);
  });

  it("flags a run of 8 or more shared words, and reports it", () => {
    const result = checkOriginalWording("Come to the historic downtown square for a free evening of music.", SOURCE);
    expect(result).toEqual({ ok: false, sharedRun: "the historic downtown square for a free evening of" });
  });

  it("isn't fooled by punctuation or case changes", () => {
    expect(checkOriginalWording("FREE EVENING—OF LIVE JAZZ, UNDER THE STARS; FEATURING!", SOURCE).ok).toBe(false);
  });

  it("passes when there's no source description to compare against", () => {
    expect(checkOriginalWording("Anything at all", null)).toEqual({ ok: true, sharedRun: null });
  });
});
