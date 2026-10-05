import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseFilters } from "@/lib/site/filters";
import { FilterChips } from "./filter-chips";

/**
 * The chip bar rendered to plain HTML, as a browser without JavaScript gets
 * it: every control must be a link or a native <details> menu.
 */

const options = {
  cities: [
    { value: "bentonville", label: "Bentonville" },
    { value: "rogers", label: "Rogers" },
  ],
  categories: [{ value: "music", label: "Music" }],
};
const render = (q: Record<string, string>, extra: Partial<Parameters<typeof FilterChips>[0]> = {}) =>
  renderToStaticMarkup(<FilterChips base="/upcoming" filters={parseFilters(q)} options={options} {...extra} />);
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));

describe("FilterChips", () => {
  it("works without JavaScript: links and native menus only, no selects, checkboxes, or Apply button", () => {
    const html = render({});
    expect(html).not.toMatch(/<select|type="checkbox"|<button|<form/);
    expect(html).toMatch(/<details data-chip-menu/);
    expect(html).toMatch(/>Venue type</);
    expect(html).not.toMatch(/>Where</);
  });

  it("each chip links to the right filtered URL", () => {
    const links = hrefs(render({}));
    expect(links).toContain("/upcoming?city=rogers");
    expect(links).toContain("/upcoming?category=music");
    expect(links).toContain("/upcoming?venue_type=library");
    expect(links).toContain("/upcoming?tags=free");
    expect(links).toContain("/upcoming?tags=en-espanol");
    expect(links).toContain("/upcoming?recurring=1");
  });

  it("shows the selected state from the URL, not by color alone, with a way to clear each", () => {
    const html = render({ city: "rogers", tags: "free", recurring: "1" });
    // City chip shows the value and a clear (x) link.
    expect(html).toMatch(/aria-label="City: Rogers\. Change city"/);
    expect(hrefs(html)).toContain("/upcoming?tags=free&recurring=1");
    // The Free chip is marked and links to removing itself; it carries a check icon.
    const freeTag = html.match(/<a [^>]*href="\/upcoming\?city=rogers&amp;recurring=1"[^>]*>/)?.[0] ?? "";
    expect(freeTag).toMatch(/aria-current="true"/);
    expect(html.slice(html.indexOf(freeTag) + freeTag.length)).toMatch(/^<svg/);
    expect(html).toMatch(/\(on; select to remove\)/);
    // The other tags are not marked.
    expect(html).not.toMatch(/aria-current="true"[^>]*>[^<]*Family-friendly/);
  });

  it("Clear all removes every filter and keeps the date range; it appears only when something is on", () => {
    expect(render({})).not.toMatch(/Clear all/);
    const html = render({ city: "rogers", category: "music", tags: "free,21-plus", venue_type: "library", recurring: "1" }, { keep: { from: "2026-10-09", days: "3" } });
    const clear = [...html.matchAll(/href="([^"]+)"[^>]*>Clear all/g)].map((m) => m[1].replaceAll("&amp;", "&"));
    expect(clear.length).toBeGreaterThan(0);
    expect(new Set(clear)).toEqual(new Set(["/upcoming?from=2026-10-09&days=3"]));
  });

  it("shows the result count and the phone's Filters button with the active count", () => {
    const html = render({ tags: "free" }, { count: 12 });
    expect(html).toMatch(/12 events/);
    expect(html).toMatch(/Filters \(1\)/);
  });
});
