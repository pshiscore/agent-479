import { describe, expect, it, vi } from "vitest";
import { PoliteClient } from "../http";
import { SourceConfigError, type SourceRow } from "../types";
import { icsFeedUrls, icsFetcher } from "./ics";

const source = (config: Record<string, unknown>, baseUrl = "https://www.city.example/") =>
  ({ slug: "city-test", baseUrl, config }) as SourceRow;

const feed = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "X-WR-TIMEZONE:America/Chicago", ...events, "END:VCALENDAR"].join("\r\n");
const vevent = (uid: string, summary: string) =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${summary}\r\nDTSTART:20261010T190000\r\nDESCRIPTION:secret\r\nEND:VEVENT`;

function http(routes: Record<string, string>) {
  const f = vi.fn(async (url: string | URL) => {
    const body = routes[String(url)];
    return body === undefined ? new Response("", { status: 404 }) : new Response(body);
  });
  return new PoliteClient({ fetch: f as unknown as typeof fetch, userAgent: "Agent479Bot (contact: t@example.org)", minGapMs: 0 });
}

describe("icsFeedUrls", () => {
  it("builds one CivicPlus URL per category", () => {
    expect(icsFeedUrls(source({ icsPath: "/common/modules/iCalendar/iCalendar.aspx", catIds: [30, 33] }))).toEqual([
      "https://www.city.example/common/modules/iCalendar/iCalendar.aspx?catID=30&feed=calendar",
      "https://www.city.example/common/modules/iCalendar/iCalendar.aspx?catID=33&feed=calendar",
    ]);
  });

  it("uses a single feedUrl as given", () => {
    expect(icsFeedUrls(source({ feedUrl: "https://lib.example/feeds?data=abc" }))).toEqual(["https://lib.example/feeds?data=abc"]);
  });

  it("refuses a source with no usable feed config", () => {
    expect(() => icsFeedUrls(source({ feedUrl: null }))).toThrow(SourceConfigError);
    expect(() => icsFeedUrls(source({ feedUrl: "http://insecure.example/x.ics" }))).toThrow(SourceConfigError);
  });
});

describe("icsFetcher", () => {
  it("reads every category feed, keeps one item per UID, and stores facts only", async () => {
    const base = "https://www.city.example/common/modules/iCalendar/iCalendar.aspx";
    const client = http({
      [`${base}?catID=30&feed=calendar`]: feed(vevent("a@city", "Concert"), vevent("b@city", "Movie Night")),
      [`${base}?catID=33&feed=calendar`]: feed(vevent("b@city", "Movie Night")),
    });
    const result = await icsFetcher.fetch(
      source({ icsPath: "/common/modules/iCalendar/iCalendar.aspx", catIds: [30, 33] }),
      client,
    );
    expect(result.items.map((i) => i.externalId)).toEqual(["a@city", "b@city"]);
    expect(result.stats).toEqual({ events: 3, duplicates: 1 });
    expect(result.feedUrls).toHaveLength(2);
    expect(result.items[0].payload).toMatchObject({
      format: "ics",
      feed: { defaultTimezone: "America/Chicago" },
      event: { summary: "Concert", dtstart: { value: "20261010T190000", isDate: false } },
    });
    // The description is kept out of the payload, in its own internal field.
    expect(JSON.stringify(result.items.map((i) => i.payload))).not.toContain("secret");
    expect(result.items[0].descriptionText).toBe("secret");
    expect(result.items[0].descriptionPurgeAfter?.toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });

  it("fails clearly when a 200 response isn't a calendar (e.g. a challenge page)", async () => {
    const client = http({ "https://lib.example/feed.ics": "<html>Checking your browser...</html>" });
    await expect(icsFetcher.fetch(source({ feedUrl: "https://lib.example/feed.ics" }), client)).rejects.toThrow(
      /not a valid calendar/,
    );
  });
});
