import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Who may see what, decided before any page renders (src/proxy.ts).
 *
 * - /admin (and /api/admin) always needs the admin credentials
 *   (ADMIN_USERNAME, ADMIN_PASSWORD). If they aren't set, it's closed.
 * - While the site is locked, every other path needs the preview credentials
 *   (SITE_PREVIEW_USER, SITE_PREVIEW_PASSWORD), which the owner can share
 *   without giving admin access. Admin credentials work too. If the preview
 *   credentials aren't set, the locked site is closed, never open.
 * - Always public: /bot (who we are and how to opt out), /robots.txt, the
 *   cron routes (they check CRON_SECRET themselves), and Next's static build
 *   files.
 * - Production is locked unless SITE_LOCKED is exactly "false"; everywhere
 *   else it's locked only when SITE_LOCKED is "true". While locked, and on
 *   every non-production deployment, responses carry X-Robots-Tag: noindex.
 */

export interface AccessEnv {
  [key: string]: string | undefined;
  SITE_LOCKED?: string;
  SITE_PREVIEW_USER?: string;
  SITE_PREVIEW_PASSWORD?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  VERCEL_ENV?: string;
}

export type AccessDecision =
  | { allow: true; noindex: boolean }
  | { allow: false; status: 401; realm: string; noindex: true }
  | { allow: false; status: 503; message: string; noindex: true };

export const PREVIEW_REALM = "479 Guide preview";
export const ADMIN_REALM = "479 Guide admin";

const PUBLIC_PATHS = [/^\/bot\/?$/, /^\/robots\.txt$/, /^\/api\/cron\//, /^\/_next\/static\//, /^\/favicon\.ico$/];
const ADMIN_PATHS = [/^\/admin(\/|$)/, /^\/api\/admin(\/|$)/];

export function isProduction(env: AccessEnv): boolean {
  return env.VERCEL_ENV === "production";
}

export function isSiteLocked(env: AccessEnv): boolean {
  return isProduction(env) ? env.SITE_LOCKED !== "false" : env.SITE_LOCKED === "true";
}

/** Parses "Basic base64(user:pass)". Null for anything else. */
export function parseBasicAuth(header: string | null): { user: string; password: string } | null {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header ?? "");
  if (!m) return null;
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  const i = decoded.indexOf(":");
  return i < 0 ? null : { user: decoded.slice(0, i), password: decoded.slice(i + 1) };
}

// Hash both sides first, so the comparison takes the same time whatever the lengths.
const same = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

function matches(given: { user: string; password: string } | null, user?: string, password?: string): boolean {
  if (!given || !user || !password) return false;
  // Evaluate both, so a wrong user name takes as long as a wrong password.
  const u = same(given.user, user);
  const p = same(given.password, password);
  return u && p;
}

export function decideAccess(pathname: string, authorization: string | null, env: AccessEnv): AccessDecision {
  const locked = isSiteLocked(env);
  const noindex = locked || !isProduction(env);
  const creds = parseBasicAuth(authorization);
  const admin = matches(creds, env.ADMIN_USERNAME, env.ADMIN_PASSWORD);

  if (ADMIN_PATHS.some((p) => p.test(pathname))) {
    if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) return { allow: false, status: 503, message: "Admin is not configured.", noindex: true };
    return admin ? { allow: true, noindex: true } : { allow: false, status: 401, realm: ADMIN_REALM, noindex: true };
  }
  if (PUBLIC_PATHS.some((p) => p.test(pathname)) || !locked) return { allow: true, noindex };
  if (!env.SITE_PREVIEW_USER || !env.SITE_PREVIEW_PASSWORD) {
    return { allow: false, status: 503, message: "This site isn't open yet.", noindex: true };
  }
  if (admin || matches(creds, env.SITE_PREVIEW_USER, env.SITE_PREVIEW_PASSWORD)) return { allow: true, noindex: true };
  return { allow: false, status: 401, realm: PREVIEW_REALM, noindex: true };
}
