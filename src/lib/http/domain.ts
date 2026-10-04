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

/** True when `host` is `domain` or one of its subdomains. */
export function isWithinDomain(host: string, domain: string): boolean {
  const h = normalizeDomain(host);
  return h !== null && (h === domain || h.endsWith(`.${domain}`));
}
