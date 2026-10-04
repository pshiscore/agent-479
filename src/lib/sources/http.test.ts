import { describe, expect, it, vi } from "vitest";
import { FetchBlockedError, FetchNotPermittedError } from "@/lib/http/fetch";
import { FetchFailedError, PoliteClient } from "./http";

const UA = "Agent479Bot (contact: test@example.org)";

/** A fake web: path → response, plus a log of every request made. */
function fakeWeb(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const f = vi.fn(async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    const route = routes[u];
    return route ? route() : new Response("not found", { status: 404 });
  });
  return { fetch: f as unknown as typeof fetch, calls };
}

function client(fetchImpl: typeof globalThis.fetch, extra: Record<string, unknown> = {}) {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const c = new PoliteClient({
    fetch: fetchImpl,
    userAgent: UA,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    ...extra,
  });
  return { c, sleeps };
}

const ics = () => new Response("BEGIN:VCALENDAR\nEND:VCALENDAR", { headers: { "content-type": "text/calendar" } });

describe("PoliteClient", () => {
  it("checks robots.txt first, then fetches an allowed path", async () => {
    const web = fakeWeb({
      "https://city.example/robots.txt": () => new Response("User-agent: *\nDisallow: /RSS.aspx"),
      "https://city.example/feed.ics": ics,
    });
    const { c } = client(web.fetch);
    const res = await c.get("https://city.example/feed.ics");
    expect(res.text).toContain("VCALENDAR");
    expect(web.calls).toEqual(["https://city.example/robots.txt", "https://city.example/feed.ics"]);
  });

  it("treats a robots disallow as a block, and doesn't request the page", async () => {
    const web = fakeWeb({ "https://city.example/robots.txt": () => new Response("User-agent: *\nDisallow: /RSS.aspx") });
    const { c } = client(web.fetch);
    await expect(c.get("https://city.example/RSS.aspx?x=1")).rejects.toBeInstanceOf(FetchBlockedError);
    expect(web.calls).toEqual(["https://city.example/robots.txt"]);
  });

  it("allows everything when robots.txt is 404, but refuses when it's 5xx", async () => {
    const ok = fakeWeb({ "https://a.example/feed.ics": ics });
    await expect(client(ok.fetch).c.get("https://a.example/feed.ics")).resolves.toBeTruthy();
    const down = fakeWeb({ "https://b.example/robots.txt": () => new Response("", { status: 503 }) });
    await expect(client(down.fetch).c.get("https://b.example/feed.ics")).rejects.toThrow(/robots.txt unreachable/);
    expect(down.calls).toEqual(["https://b.example/robots.txt"]);
  });

  it("stops when robots.txt itself is refused", async () => {
    const web = fakeWeb({ "https://c.example/robots.txt": () => new Response("", { status: 403 }) });
    await expect(client(web.fetch).c.get("https://c.example/feed.ics")).rejects.toBeInstanceOf(FetchBlockedError);
  });

  it("re-checks every redirect hop, so a redirect can't reach an unpermitted domain", async () => {
    const web = fakeWeb({
      "https://d.example/go": () => new Response("", { status: 302, headers: { location: "https://crystalbridges.org/x" } }),
    });
    await expect(client(web.fetch).c.get("https://d.example/go")).rejects.toBeInstanceOf(FetchNotPermittedError);
    expect(web.calls.some((u) => u.includes("crystalbridges"))).toBe(false);
  });

  it("follows an allowed redirect and reports the final URL", async () => {
    const web = fakeWeb({
      "https://e.example/old": () => new Response("", { status: 301, headers: { location: "/new.ics" } }),
      "https://e.example/new.ics": ics,
    });
    const res = await client(web.fetch).c.get("https://e.example/old");
    expect(res.url).toBe("https://e.example/new.ics");
  });

  it("waits between requests to one host, longer when Crawl-delay says so", async () => {
    const web = fakeWeb({
      "https://f.example/robots.txt": () => new Response("User-agent: *\nCrawl-delay: 10"),
      "https://f.example/1.ics": ics,
      "https://f.example/2.ics": ics,
    });
    const { c, sleeps } = client(web.fetch);
    await c.get("https://f.example/1.ics");
    await c.get("https://f.example/2.ics");
    // Crawl-delay applies from the first request after robots.txt is read.
    expect(sleeps).toEqual([10_000, 10_000]);
  });

  it("waits the default 3 s gap when there's no Crawl-delay", async () => {
    const web = fakeWeb({ "https://k.example/1.ics": ics, "https://k.example/2.ics": ics });
    const { c, sleeps } = client(web.fetch);
    await c.get("https://k.example/1.ics");
    await c.get("https://k.example/2.ics");
    expect(sleeps).toEqual([3_000, 3_000]);
  });

  it("caches robots.txt per origin", async () => {
    const web = fakeWeb({ "https://g.example/1.ics": ics, "https://g.example/2.ics": ics });
    const { c } = client(web.fetch);
    await c.get("https://g.example/1.ics");
    await c.get("https://g.example/2.ics");
    expect(web.calls.filter((u) => u.endsWith("robots.txt"))).toHaveLength(1);
  });

  it("fails on HTTP errors and oversized bodies", async () => {
    const web = fakeWeb({
      "https://h.example/gone.ics": () => new Response("", { status: 500 }),
      "https://h.example/big.ics": () => new Response("x".repeat(2_000)),
    });
    const { c } = client(web.fetch, { maxBytes: 1_000 });
    await expect(c.get("https://h.example/gone.ics")).rejects.toThrow(FetchFailedError);
    await expect(c.get("https://h.example/big.ics")).rejects.toThrow(/byte cap/);
  });
});
