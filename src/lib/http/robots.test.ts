import { describe, expect, it } from "vitest";
import { isAllowed, parseRobots } from "./robots";

// Shaped like the CivicPlus robots.txt in docs/sources-terms.md.
const CIVICPLUS = `
User-agent: *
Disallow: /RSS.aspx
Disallow: /Search
Disallow: /calendar.aspx?view=
Allow: /common/modules/iCalendar/

User-agent: BadBot
Disallow: /
`;

describe("robots.txt", () => {
  it("allows the ICS endpoint and blocks RSS for a generic agent", () => {
    const r = parseRobots(CIVICPLUS);
    expect(isAllowed(r, "/common/modules/iCalendar/iCalendar.aspx?catID=32&feed=calendar")).toBe(true);
    expect(isAllowed(r, "/RSS.aspx?type=5")).toBe(false);
    expect(isAllowed(r, "/calendar.aspx?view=list")).toBe(false);
    expect(isAllowed(r, "/calendar.aspx?EID=1")).toBe(true);
  });

  it("uses our own group over *, and only ours", () => {
    const r = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: Agent479Bot\nAllow: /feeds\nDisallow: /");
    expect(isAllowed(r, "/feeds/events.ics")).toBe(true);
    expect(isAllowed(r, "/other")).toBe(false);
  });

  it("matches the product token case-insensitively, and groups consecutive agents", () => {
    const r = parseRobots("User-agent: googlebot\nUser-agent: AGENT479BOT\nDisallow: /private");
    expect(isAllowed(r, "/private/x")).toBe(false);
    expect(isAllowed(r, "/public")).toBe(true);
  });

  it("lets the longest rule win, and Allow win a tie", () => {
    const r = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /a/b/c\nAllow: /t\nDisallow: /t");
    expect(isAllowed(r, "/a/x")).toBe(false);
    expect(isAllowed(r, "/a/b/x")).toBe(true);
    expect(isAllowed(r, "/a/b/c/x")).toBe(false);
    expect(isAllowed(r, "/t")).toBe(true);
  });

  it("supports * and $ patterns", () => {
    const r = parseRobots("User-agent: *\nDisallow: /*?format=ical\nDisallow: /*.json$");
    expect(isAllowed(r, "/events?format=ical")).toBe(false);
    expect(isAllowed(r, "/events?format=html")).toBe(true);
    expect(isAllowed(r, "/data.json")).toBe(false);
    expect(isAllowed(r, "/data.json?x=1")).toBe(true);
  });

  it("treats an empty Disallow, no matching group, or an empty file as allow-all", () => {
    expect(isAllowed(parseRobots("User-agent: *\nDisallow:"), "/x")).toBe(true);
    expect(isAllowed(parseRobots("User-agent: OtherBot\nDisallow: /"), "/x")).toBe(true);
    expect(isAllowed(parseRobots(""), "/x")).toBe(true);
  });

  it("reads Crawl-delay from the chosen group", () => {
    expect(parseRobots("User-agent: *\nCrawl-delay: 10\nDisallow: /x").crawlDelaySeconds).toBe(10);
    expect(parseRobots("User-agent: *\nDisallow: /x").crawlDelaySeconds).toBeNull();
  });

  it("ignores comments", () => {
    const r = parseRobots("User-agent: * # everyone\nDisallow: /secret # keep out");
    expect(isAllowed(r, "/secret")).toBe(false);
  });
});
