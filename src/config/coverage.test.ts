import { describe, expect, it } from "vitest";
import { inCoverageArea } from "./coverage";

describe("inCoverageArea", () => {
  it("covers both counties' places and nothing beyond", () => {
    for (const c of ["Bentonville", "Pea Ridge", "Prairie Grove", "Springdale", "elm springs", " Fayetteville "]) expect(inCoverageArea(c)).toBe(true);
    for (const c of ["Eureka Springs", "Hindsville", "Huntsville", "", null]) expect(inCoverageArea(c)).toBe(false);
  });
});
