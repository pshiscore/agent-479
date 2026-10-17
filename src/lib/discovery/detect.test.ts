import { describe, expect, it } from "vitest";
import { civicPlusFeeds, feedSamples, icsSamples, icsWhen, jsonLdEvents, libcalIcsUrl, NOT_EVENTS_CALENDAR, pageSignals, suggestFilters, termsFlags } from "./detect";

// Fixtures are written for these tests (no source text).
describe("pageSignals", () => {
  it("finds platforms, feed links, LibCal, Google Calendar, and the terms link", () => {
    const html = `<html><head>
      <link rel="alternate" type="text/calendar" title="Events iCal" href="/events/?ical=1">
      <link rel="alternate" type="application/rss+xml" title="News" href="https://example.org/feed/">
      <link rel="stylesheet" href="/wp-content/plugins/the-events-calendar/style.css"></head>
      <body><a href="webcal://example.org/cal.ics">Subscribe</a>
      <a href="https://examplelib.libcal.com/calendar">Library calendar</a>
      <iframe src="https://calendar.google.com/calendar/embed?src=abc%40group.calendar.google.com&ctz=America/Chicago"></iframe>
      <a href="/privacy">Privacy Policy</a><a href="/site/terms-of-use">Terms of Use</a></body></html>`;
    const s = pageSignals(html, "https://example.org/");
    expect(s).toMatchObject({ eventsCalendarPlugin: true, civicplus: false, squarespace: false });
    expect(s.alternates.map((a) => a.href)).toEqual(["https://example.org/events/?ical=1", "https://example.org/feed/"]);
    expect(s.icsLinks).toEqual(["https://example.org/cal.ics"]);
    expect(s.libcalLinks).toEqual(["https://examplelib.libcal.com/calendar"]);
    expect(s.googleCalendarIds).toEqual(["abc@group.calendar.google.com"]);
    expect(s.termsLink).toBe("https://example.org/site/terms-of-use");
  });
});

describe("civicPlusFeeds", () => {
  it("reads each calendar's id and name", () => {
    const html = `<div class="row"><span>Community Events</span><a href="/common/modules/iCalendar/iCalendar.aspx?catID=32&amp;feed=calendar">Subscribe</a></div>
      <div class="row"><span>Public Meetings</span><a href="/common/modules/iCalendar/iCalendar.aspx?catID=42&feed=calendar">Subscribe</a></div>`;
    const feeds = civicPlusFeeds(html, "https://www.city.example/iCalendar.aspx");
    expect(feeds).toEqual([
      { catId: 32, name: "Community Events", url: "https://www.city.example/common/modules/iCalendar/iCalendar.aspx?catID=32&feed=calendar" },
      { catId: 42, name: "Public Meetings", url: "https://www.city.example/common/modules/iCalendar/iCalendar.aspx?catID=42&feed=calendar" },
    ]);
    expect(feeds.filter((f) => NOT_EVENTS_CALENDAR.test(f.name)).map((f) => f.catId)).toEqual([42]);
  });

  it("keeps the calendars that are events", () => {
    expect(["Holidays and Community Events", "Parks and Recreation", "Library", "Volunteer Opportunities"].some((n) => NOT_EVENTS_CALENDAR.test(n))).toBe(false);
    expect(["City Council", "Planning Commission", "Adult Sports", "Holiday Closures", "Board of Adjustment"].every((n) => NOT_EVENTS_CALENDAR.test(n) || /sports/i.test(n))).toBe(true);
  });
});

describe("libcalIcsUrl", () => {
  it("finds the subscribe link", () => {
    expect(libcalIcsUrl(`<a href="https://lib.libcal.com/ical_subscribe.php?src=p&amp;cid=1234">iCal</a>`, "https://lib.libcal.com/calendar")).toBe("https://lib.libcal.com/ical_subscribe.php?src=p&cid=1234");
  });
});

describe("samples", () => {
  it("takes upcoming iCal events first, facts only", () => {
    const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:1", "SUMMARY:Past Fair", "DTSTART:20260101T100000", "END:VEVENT", "BEGIN:VEVENT", "UID:2", "SUMMARY:Story Time", "DESCRIPTION:not kept", "DTSTART:20261021T100000", "LOCATION:Main Library", "END:VEVENT", "BEGIN:VEVENT", "UID:3", "SUMMARY:Weekly Chess", "DTSTART:20250105T160000", "RRULE:FREQ=WEEKLY", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const r = icsSamples(ics, new Date("2026-10-17T12:00:00Z"));
    expect(r.count).toBe(3);
    expect(r.samples).toEqual([
      { title: "Story Time", startAt: "2026-10-21 10:00", location: "Main Library", url: null },
      { title: "Weekly Chess", startAt: "2025-01-05 16:00 (repeats)", location: null, url: null },
    ]);
    expect(icsWhen("20261021")).toBe("2026-10-21");
  });

  it("reads schema.org events from JSON-LD, including @graph and subtypes", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"MusicEvent","name":"Band Night","startDate":"2026-10-24T20:00:00-05:00","location":{"@type":"Place","name":"The Hall"}}]}</script>
      <script type="application/ld+json">[{"@type":"Event","name":"Farmers Market","startDate":"2026-10-25"}]</script>`;
    expect(jsonLdEvents(html)).toEqual({ count: 2, samples: [
      { title: "Band Night", startAt: "2026-10-24T20:00:00-05:00", location: "The Hall", url: null },
      { title: "Farmers Market", startAt: "2026-10-25", location: null, url: null },
    ] });
  });

  it("reads RSS item titles", () => {
    expect(feedSamples(`<rss><channel><item><title><![CDATA[Fall Fest]]></title><pubDate>Sat, 17 Oct 2026</pubDate></item></channel></rss>`).samples).toEqual([{ title: "Fall Fest", startAt: "Sat, 17 Oct 2026", location: null, url: null }]);
  });
});

describe("termsFlags and suggestFilters", () => {
  it("flags phrases the owner should read", () => {
    expect(termsFlags("You may not use automated means, robots, or scrapers. You may not copy or republish content.")).toEqual(["automated", "scrape", "robot or bot", "no copying"]);
    expect(termsFlags("Thanks for visiting.")).toEqual([]);
  });

  it("suggests filter phrases found in titles, without overlaps", () => {
    expect(suggestFilters(["City Council Meeting", "Library Board Meeting", "Story Time", "Office Closed"])).toEqual(["Meeting", "Closed"]);
    expect(suggestFilters(["Story Time"])).toEqual([]);
  });
});
