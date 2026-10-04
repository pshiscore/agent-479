import { botFetch, FetchBlockedError } from "@/lib/http/fetch";
import { isAllowed, parseRobots, type RobotsRules } from "@/lib/http/robots";

/**
 * How fetchers read the web: through botFetch (honest user agent, stops on
 * blocks, never touches unpermitted domains), plus robots.txt on every
 * request, a per-host pause between requests (or the site's Crawl-delay if
 * longer), a timeout, and a size cap. Redirects are followed by hand so every
 * hop gets the same checks. A robots disallow is a block: it throws
 * FetchBlockedError, and the caller stops.
 */

export class FetchFailedError extends Error {
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(`Fetch failed for ${url}: ${reason}`);
    this.name = "FetchFailedError";
  }
}

export interface PoliteResponse {
  url: string;
  status: number;
  contentType: string | null;
  text: string;
}

export interface PoliteOptions {
  fetch?: typeof fetch;
  userAgent?: string;
  minGapMs?: number;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
const ROBOTS_MAX_BYTES = 512 * 1024;

export class PoliteClient {
  private readonly robots = new Map<string, { rules: RobotsRules; fetchedAt: number }>();
  private readonly lastRequestAt = new Map<string, number>();
  private readonly opts: Required<Omit<PoliteOptions, "fetch" | "userAgent">> &
    Pick<PoliteOptions, "fetch" | "userAgent">;

  constructor(opts: PoliteOptions = {}) {
    this.opts = {
      minGapMs: 3_000,
      timeoutMs: 30_000,
      maxBytes: 10 * 1024 * 1024,
      maxRedirects: 5,
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...opts,
    };
  }

  /** When robots.txt for `origin` was last fetched in this client, or null. */
  robotsCheckedAt(origin: string): Date | null {
    const r = this.robots.get(origin);
    return r ? new Date(r.fetchedAt) : null;
  }

  async get(url: string, accept = "*/*"): Promise<PoliteResponse> {
    let current = new URL(url);
    for (let hop = 0; hop <= this.opts.maxRedirects; hop++) {
      if (current.protocol !== "https:" && current.protocol !== "http:") {
        throw new FetchFailedError(String(current), `unsupported protocol ${current.protocol}`);
      }
      const rules = await this.robotsFor(current.origin);
      if (!isAllowed(rules, current.pathname + current.search)) {
        throw new FetchBlockedError(String(current), "robots.txt disallows this path");
      }
      const res = await this.request(current, accept, rules.crawlDelaySeconds);
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, current);
        continue;
      }
      if (!res.ok) throw new FetchFailedError(String(current), `HTTP ${res.status}`);
      return {
        url: String(current),
        status: res.status,
        contentType: res.headers.get("content-type"),
        text: await readCapped(res, this.opts.maxBytes, String(current)),
      };
    }
    throw new FetchFailedError(url, `more than ${this.opts.maxRedirects} redirects`);
  }

  private async robotsFor(origin: string): Promise<RobotsRules> {
    const cached = this.robots.get(origin);
    if (cached && this.opts.now() - cached.fetchedAt < ROBOTS_TTL_MS) return cached.rules;

    // botFetch throws FetchBlockedError if robots.txt itself refuses us (401, 403, ...).
    const res = await this.request(new URL("/robots.txt", origin), "text/plain", null);
    let rules: RobotsRules;
    if (res.ok) {
      rules = parseRobots(await readCapped(res, ROBOTS_MAX_BYTES, `${origin}/robots.txt`));
    } else if (res.status >= 400 && res.status < 500) {
      // RFC 9309: robots.txt is "unavailable", so there are no restrictions.
      rules = { rules: [], crawlDelaySeconds: null };
    } else {
      // RFC 9309: unreachable (5xx, or redirect loops) means assume full disallow.
      throw new FetchFailedError(`${origin}/robots.txt`, `robots.txt unreachable (HTTP ${res.status}); not fetching`);
    }
    this.robots.set(origin, { rules, fetchedAt: this.opts.now() });
    return rules;
  }

  /** One request, after waiting out the per-host gap. Redirects are returned, not followed. */
  private async request(url: URL, accept: string, crawlDelaySeconds: number | null): Promise<Response> {
    const gap = Math.max(this.opts.minGapMs, (crawlDelaySeconds ?? 0) * 1000);
    const last = this.lastRequestAt.get(url.host);
    if (last !== undefined) {
      const wait = last + gap - this.opts.now();
      if (wait > 0) await this.opts.sleep(wait);
    }
    this.lastRequestAt.set(url.host, this.opts.now());
    try {
      return await botFetch(
        url,
        { headers: { Accept: accept }, redirect: "manual", signal: AbortSignal.timeout(this.opts.timeoutMs) },
        { fetch: this.opts.fetch, userAgent: this.opts.userAgent },
      );
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new FetchFailedError(String(url), `timed out after ${this.opts.timeoutMs} ms`);
      }
      throw err;
    }
  }
}

async function readCapped(res: Response, maxBytes: number, url: string): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new FetchFailedError(url, `body is ${declared} bytes, over the ${maxBytes} byte cap`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchFailedError(url, `body exceeds the ${maxBytes} byte cap`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
