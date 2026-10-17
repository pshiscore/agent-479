import { describe, expect, it } from "vitest";
import { FetchNotPermittedError } from "@/lib/http/fetch";
import { PoliteClient } from "../http";
import type { SourceRow } from "../types";
import { jsonLdFetcher } from "./jsonld";

// Pages written for this test (no source text).
const page = (events: unknown[], next?: string) =>
  `<html><head>${next ? `<link rel="next" href="${next}">` : ""}<script type="application/ld+json">${JSON.stringify(events)}</script></head><body>Events</body></html>`;
const ev = (name: string, startDate: string, extra: Record<string, unknown> = {}) => ({
  "@context": "https://schema.org",
  "@type": "Event",
  name,
  startDate,
  url: `https://garden.example/event/${name.toLowerCase().replace(/\W+/g, "-")}/`,
  description: "Written for this test; staged internally only.",
  location: { "@type": "Place", name: "The Garden", address: { "@type": "PostalAddress", streetAddress: "4703 N Crossover Rd", addressLocality: "Fayetteville" } },
  ...extra,
});

function web(pages: Record<string, string>) {
  const calls: string[] = [];
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
    const body = pages[url];
    return new Response(body ?? "not found", { status: body ? 200 : 404, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  return { calls, http: new PoliteClient({ fetch: fakeFetch, userAgent: "Agent479Bot/test", minGapMs: 0, sleep: async () => {} }) };
}

const source = (config: Record<string, unknown>, over: Partial<SourceRow> = {}) =>
  ({ slug: "garden-page-data", baseUrl: "https://garden.example/", config, disabledReason: "untested", ...over }) as SourceRow;

describe("jsonLdFetcher", () => {
  it("reads events from JSON-LD, keeps descriptions out of the payload, and follows rel=next up to maxPages", async () => {
    const w = web({
      "https://garden.example/calendar/": page([ev("Plant Swap", "2026-10-24T10:00:00-05:00"), ev("Plant Swap", "2026-10-24T10:00:00-05:00")], "/calendar/page/2/"),
      "https://garden.example/calendar/page/2/": page([ev("Night Walk", "2026-10-30T19:00:00-05:00")], "https://other.example/x"),
    });
    const r = await jsonLdFetcher.fetch(source({ pageUrl: "https://garden.example/calendar/", maxPages: 3 }), w.http);
    expect(r.items.map((i) => (i.payload.event as { name: string }).name)).toEqual(["Plant Swap", "Night Walk"]);
    expect(r.stats).toEqual({ pages: 2, events: 3, duplicates: 1 });
    const item = r.items[0];
    expect(item.descriptionText).toMatch(/Written for this test/);
    expect(JSON.stringify(item.payload)).not.toMatch(/Written for this test/);
    expect(item.payload.event).toMatchObject({ location: { name: "The Garden", city: "Fayetteville" } });
    expect(item.descriptionPurgeAfter).toEqual(new Date("2026-11-24T00:00:00Z"));
    // The off-site "next" link is never followed.
    expect(w.calls).not.toContain("https://other.example/x");
  });

  it("reads one page by default", async () => {
    const w = web({ "https://garden.example/calendar/": page([ev("Plant Swap", "2026-10-24")], "/calendar/page/2/") });
    const r = await jsonLdFetcher.fetch(source({ pageUrl: "https://garden.example/calendar/" }), w.http);
    expect(r.stats.pages).toBe(1);
  });

  it("refuses sources awaiting permission or blocked, pages on another site, and unpermitted domains", async () => {
    const w = web({});
    await expect(jsonLdFetcher.fetch(source({ pageUrl: "https://garden.example/calendar/" }, { disabledReason: "awaiting_permission" }), w.http)).rejects.toThrow(/awaiting_permission/);
    await expect(jsonLdFetcher.fetch(source({ pageUrl: "https://garden.example/calendar/" }, { disabledReason: "blocked" }), w.http)).rejects.toThrow(/blocked/);
    await expect(jsonLdFetcher.fetch(source({ pageUrl: "https://elsewhere.example/calendar/" }), w.http)).rejects.toThrow(/own site/);
    const cb = source({ pageUrl: "https://crystalbridges.org/calendar/" }, { baseUrl: "https://crystalbridges.org/" });
    await expect(jsonLdFetcher.fetch(cb, w.http)).rejects.toBeInstanceOf(FetchNotPermittedError);
    expect(w.calls).toEqual([]);
  });
});
