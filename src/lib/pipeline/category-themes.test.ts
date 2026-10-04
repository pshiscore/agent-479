import { describe, expect, it } from "vitest";
import { themeOf } from "./category-themes";

describe("themeOf", () => {
  it("groups hints that differ only in format words and plurals", () => {
    expect(themeOf("Blood donation drives")).toBe("blood donation");
    expect(themeOf("Blood donation")).toBe("blood donation");
    expect(themeOf("Library programs")).toBe("library");
    expect(themeOf("Board game events")).toBe("board game");
    expect(themeOf("Civic participation")).toBe("civic participation");
    expect(themeOf("Health & Wellness")).toBe("health and wellness");
  });
});
