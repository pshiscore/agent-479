import { botUserAgent } from "@/lib/bot-identity";
import { isWithinDomain } from "./domain";

/**
 * The only way this codebase makes outbound requests (enforced by ESLint).
 * Always sends our honest user agent, and treats any refusal as final: a
 * block means stop. Callers must not retry a FetchBlockedError with another
 * user agent, tool, or route; record it and ask the owner.
 */

/**
 * Statuses that mean the site refused us. 401, 403, and 429 are the owner's
 * list; 406 counts too (MiLB refused a fetch that way), and 451 is an
 * explicit legal refusal. Timeouts, DNS failures, and 5xx are not blocks:
 * they retry on the next run.
 */
export const BLOCK_STATUSES = new Set([401, 403, 406, 429, 451]);

export class FetchBlockedError extends Error {
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(`Blocked by ${new URL(url).host}: ${reason}. Stop; don't retry another way. Record it and ask the owner.`);
    this.name = "FetchBlockedError";
  }
}

/**
 * Domains we never fetch from, for any reason, until written permission
 * arrives (CLAUDE.md). Displaying links to them is fine; fetching isn't.
 * Remove a domain here only together with its source's terms_notes update.
 */
export const UNPERMITTED_DOMAINS = [
  "waltonartscenter.org",
  "walmartamp.com",
  "amptickets.com",
  "crystalbridges.org",
  "themomentary.org",
] as const;

/** Our own rule refused the request before it was sent. */
export class FetchNotPermittedError extends Error {
  constructor(readonly url: string) {
    super(`Not permitted: ${new URL(url).host} is awaiting permission (CLAUDE.md). Nothing was sent.`);
    this.name = "FetchNotPermittedError";
  }
}

/** Why a response is a refusal, or null if it isn't one. */
export function blockReason(res: Response): string | null {
  if (BLOCK_STATUSES.has(res.status)) return `HTTP ${res.status}`;
  // Cloudflare and similar return 200/503 challenge pages with a marker header.
  if (res.headers.get("cf-mitigated") === "challenge") return "bot challenge (cf-mitigated)";
  return null;
}

export async function botFetch(
  url: string | URL,
  init: RequestInit = {},
  opts: { fetch?: typeof fetch; userAgent?: string } = {},
): Promise<Response> {
  const host = new URL(url).hostname;
  if (UNPERMITTED_DOMAINS.some((d) => isWithinDomain(host, d))) throw new FetchNotPermittedError(String(url));
  const headers = new Headers(init.headers);
  headers.set("User-Agent", opts.userAgent ?? botUserAgent());
  const res = await (opts.fetch ?? fetch)(url, { ...init, headers });
  const reason = blockReason(res);
  if (reason) throw new FetchBlockedError(String(url), reason);
  return res;
}
