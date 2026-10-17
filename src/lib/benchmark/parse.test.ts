import { describe, expect, it } from "vitest";
import { mondayOf, parseLine, parseLines } from "./parse";

const WEEK = "2026-10-12";

describe("parseLine", () => {
  it.each([
    ["Fall Festivities, Oct 16", "Fall Festivities", "2026-10-16"],
    ["Sat Oct 17 - Harvest Market", "Harvest Market", "2026-10-17"],
    ["Saturday, October 17th: Harvest Market", "Harvest Market", "2026-10-17"],
    ["10/17 Harvest Market", "Harvest Market", "2026-10-17"],
    ["Harvest Market 10/17/26", "Harvest Market", "2026-10-17"],
    ["2026-10-17\tHarvest Market", "Harvest Market", "2026-10-17"],
    ["Lights of the Ozarks | Nov 21 - Dec 31", "Lights of the Ozarks", "2026-11-21"],
    ["Bikes, Blues & BBQ Oct 17-19", "Bikes, Blues & BBQ", "2026-10-17"],
    ["Harvest Market, Saturday", "Harvest Market", "2026-10-17"],
    ["Story Time (Wednesday)", "Story Time", "2026-10-14"],
  ])("%s", (line, name, date) => {
    expect(parseLine(line, WEEK)).toEqual({ name, date });
  });

  it("takes the year nearest the week", () => {
    expect(parseLine("New Year's Eve Party, Dec 31", "2027-01-04")).toEqual({ name: "New Year's Eve Party", date: "2026-12-31" });
    expect(parseLine("First Friday, Jan 1", "2026-12-28")).toEqual({ name: "First Friday", date: "2027-01-01" });
  });

  it("keeps numbers that are part of the name", () => {
    expect(parseLine("Pea Ridge 5K, Oct 17", WEEK)).toEqual({ name: "Pea Ridge 5K", date: "2026-10-17" });
  });

  it("reports lines it can't read", () => {
    expect(parseLine("Harvest Market", WEEK)).toMatchObject({ problem: "no date found" });
    expect(parseLine("Feb 30 Harvest Market", WEEK)).toMatchObject({ problem: "that date doesn't exist" });
    expect(parseLine("Oct 17", WEEK)).toMatchObject({ problem: "no event name" });
  });
});

describe("parseLines", () => {
  it("skips blanks, notes, and exact repeats; collects errors", () => {
    const r = parseLines("# Flyer weekend list\n\nFall Festivities, Oct 16\nfall festivities, Oct 16\nNo date here\n", WEEK);
    expect(r.items).toEqual([{ name: "Fall Festivities", date: "2026-10-16" }]);
    expect(r.errors).toEqual([{ line: "No date here", problem: "no date found" }]);
  });
});

describe("mondayOf", () => {
  it("finds the week's Monday", () => {
    expect(mondayOf("2026-10-17")).toBe("2026-10-12");
    expect(mondayOf("2026-10-12")).toBe("2026-10-12");
    expect(mondayOf("2026-10-18")).toBe("2026-10-12");
  });
});
