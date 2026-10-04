import { describe, expect, it, vi } from "vitest";
import { botFetch, FetchBlockedError, FetchNotPermittedError } from "./fetch";

const UA = "Agent479Bot (contact: test@example.org)";
const respond = (status: number, headers: Record<string, string> = {}) =>
  vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(
    async () => new Response("", { status, headers }),
  );

describe("botFetch", () => {
  it("sends our user agent, whatever the caller passed", async () => {
    const f = respond(200);
    await botFetch("https://example.org/", { headers: { "User-Agent": "Mozilla/5.0" } }, {
      fetch: f as unknown as typeof fetch,
      userAgent: UA,
    });
    expect(new Headers(f.mock.calls[0][1]?.headers).get("User-Agent")).toBe(UA);
  });

  it.each([401, 403, 406, 429, 451])("treats HTTP %i as a block", async (status) => {
    const f = respond(status);
    await expect(
      botFetch("https://example.org/", {}, { fetch: f as unknown as typeof fetch, userAgent: UA }),
    ).rejects.toBeInstanceOf(FetchBlockedError);
  });

  it("treats a bot challenge as a block even with a 200", async () => {
    const f = respond(200, { "cf-mitigated": "challenge" });
    await expect(
      botFetch("https://example.org/", {}, { fetch: f as unknown as typeof fetch, userAgent: UA }),
    ).rejects.toThrow(/bot challenge/);
  });

  it.each([404, 407, 500, 502, 503])("doesn't treat HTTP %i as a block", async (status) => {
    const f = respond(status);
    const res = await botFetch("https://example.org/", {}, { fetch: f as unknown as typeof fetch, userAgent: UA });
    expect(res.status).toBe(status);
  });

  it("passes other errors through for the caller to handle", async () => {
    const f = respond(404);
    const res = await botFetch("https://example.org/", {}, { fetch: f as unknown as typeof fetch, userAgent: UA });
    expect(res.status).toBe(404);
  });

  it("makes exactly one request: no retries", async () => {
    const f = respond(403);
    await botFetch("https://example.org/", {}, { fetch: f as unknown as typeof fetch, userAgent: UA }).catch(() => {});
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([
    "https://www.waltonartscenter.org/",
    "https://walmartamp.com/",
    "https://www.amptickets.com/",
    "https://crystalbridges.org/robots.txt",
    "https://themomentary.org/calendar/",
    "https://tickets.crystalbridges.org/x",
  ])("refuses %s without sending anything", async (url) => {
    const f = respond(200);
    await expect(
      botFetch(url, {}, { fetch: f as unknown as typeof fetch, userAgent: UA }),
    ).rejects.toBeInstanceOf(FetchNotPermittedError);
    expect(f).not.toHaveBeenCalled();
  });

  it("doesn't refuse lookalike domains", async () => {
    const f = respond(200);
    await botFetch("https://notcrystalbridges.org/", {}, { fetch: f as unknown as typeof fetch, userAgent: UA });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
