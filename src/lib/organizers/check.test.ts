import { describe, expect, it } from "vitest";
import { defaultNameWords, eventsLink, namesOrganizer, pageText } from "./check";

describe("pageText and namesOrganizer", () => {
  const html = `<html><head><title>George&#39;s Majestic Lounge</title><script>var x = "Ozark Music Hall";</script></head>
    <body><nav><a href="/calendar">Shows</a></nav><h1>George’s Majestic Lounge &amp; Garden</h1></body></html>`;

  it("reads visible text and the title, not scripts", () => {
    const t = pageText(html);
    expect(namesOrganizer(t, ["george's", "majestic"])).toBe(true);
    expect(namesOrganizer(t, ["ozark music hall"])).toBe(false);
  });

  it("needs every word", () => {
    expect(namesOrganizer(pageText(html), ["george", "theatre"])).toBe(false);
    expect(namesOrganizer(pageText(html), [])).toBe(false);
  });

  it("drops articles and legal suffixes from a name", () => {
    expect(defaultNameWords("The Jones Center, Inc.")).toEqual(["jones", "center"]);
  });
});

describe("eventsLink", () => {
  it("finds a same-site events or calendar link, by address or text", () => {
    expect(eventsLink(`<a href="https://facebook.com/events">Events</a><a href="/calendar">Shows</a>`, "https://www.example.org/")).toBe("https://www.example.org/calendar");
    expect(eventsLink(`<a href="/visit">Plan a visit</a><a href="https://example.org/p/123"><span>Upcoming Events</span></a>`, "https://www.example.org/")).toBe("https://example.org/p/123");
    expect(eventsLink(`<a href="/about">About</a>`, "https://example.org/")).toBeNull();
    expect(eventsLink(`<a href="/private-events">Private Events</a><a href="/calendar.aspx?a=1&amp;b=2">Calendar</a>`, "https://example.org/")).toBe("https://example.org/calendar.aspx?a=1&b=2");
    expect(eventsLink(`<a href="/leadership-programs">Programs</a><a href="/chamber-events">Calendar</a>`, "https://example.org/")).toBe("https://example.org/chamber-events");
  });
});
