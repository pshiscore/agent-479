import type { DbExecutor } from "@/lib/db/client";
import { linkPolicies } from "@/lib/db/schema";

/**
 * Outbound links go through link_policies (AGENTS.md rule 6). Call this when a
 * link is rendered, never when it's stored, so a policy change applies to
 * every existing event at once. A domain with no policy gets deep links.
 */

export type LinkPolicy = Pick<typeof linkPolicies.$inferSelect, "domain" | "mode" | "homepageUrl">;

/**
 * The one form a domain is stored and compared in, so the unique constraint
 * really prevents duplicates: lowercase, no scheme, path, port, trailing dot,
 * or leading "www.". "HTTPS://WWW.CrystalBridges.org.:443/x" → "crystalbridges.org".
 * Returns null if nothing domain-like is left.
 */
export function normalizeDomain(input: string): string | null {
  let host = input.trim().toLowerCase();
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return null;
    }
  }
  host = host
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.+$/, "");
  // Strip "www." only when a real domain remains ("www.org" stays as is).
  if (/^www\.[^.]+\.[^.]+/.test(host)) host = host.slice(4);
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** The policy covering a host: its own domain or any parent ("tickets.x.org" → "x.org"). */
export function policyFor(host: string, policies: readonly LinkPolicy[]): LinkPolicy | undefined {
  const h = normalizeDomain(host);
  if (!h) return undefined;
  return policies.find((p) => h === p.domain || h.endsWith(`.${p.domain}`));
}

/**
 * The URL we may show for `url`: unchanged, or the domain's homepage when the
 * domain only allows homepage links. Returns null for anything that isn't an
 * http(s) URL, so callers render no link rather than a bad one.
 */
export function applyLinkPolicy(url: string, policies: readonly LinkPolicy[]): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const policy = policyFor(parsed.hostname, policies);
  if (policy?.mode === "homepage_only") return policy.homepageUrl;
  return parsed.toString();
}

export async function loadLinkPolicies(db: DbExecutor): Promise<LinkPolicy[]> {
  return db
    .select({ domain: linkPolicies.domain, mode: linkPolicies.mode, homepageUrl: linkPolicies.homepageUrl })
    .from(linkPolicies);
}
