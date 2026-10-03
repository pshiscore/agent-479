import { botUserAgent } from "@/lib/bot-identity";

/**
 * The only way this codebase makes outbound requests (enforced by ESLint).
 * Always sends our honest user agent, and treats any refusal as final: a
 * block means stop. Callers must not retry a FetchBlockedError with another
 * user agent, tool, or route; record it and ask the owner.
 */

/** Statuses that mean the site refused us, as opposed to a missing page or an outage. */
export const BLOCK_STATUSES = new Set([401, 403, 406, 407, 429, 451]);

export class FetchBlockedError extends Error {
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(`Blocked by ${new URL(url).host}: ${reason}. Stop; don't retry another way. Record it and ask the owner.`);
    this.name = "FetchBlockedError";
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
  const headers = new Headers(init.headers);
  headers.set("User-Agent", opts.userAgent ?? botUserAgent());
  const res = await (opts.fetch ?? fetch)(url, { ...init, headers });
  const reason = blockReason(res);
  if (reason) throw new FetchBlockedError(String(url), reason);
  return res;
}
