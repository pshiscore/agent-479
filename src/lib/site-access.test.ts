import { describe, expect, it } from "vitest";
import { ADMIN_REALM, type AccessEnv, decideAccess, isAdminAuthorization, isSiteLocked, parseBasicAuth, PREVIEW_REALM } from "./site-access";

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
const PROD: AccessEnv = {
  VERCEL_ENV: "production",
  SITE_PREVIEW_USER: "friend",
  SITE_PREVIEW_PASSWORD: "preview-pass",
  ADMIN_USERNAME: "owner",
  ADMIN_PASSWORD: "admin-pass",
};

describe("isSiteLocked", () => {
  it("locks production unless SITE_LOCKED is exactly \"false\"", () => {
    expect(isSiteLocked(PROD)).toBe(true);
    expect(isSiteLocked({ ...PROD, SITE_LOCKED: "true" })).toBe(true);
    expect(isSiteLocked({ ...PROD, SITE_LOCKED: "no" })).toBe(true);
    expect(isSiteLocked({ ...PROD, SITE_LOCKED: "false" })).toBe(false);
  });
  it("locks other environments only when SITE_LOCKED is \"true\"", () => {
    expect(isSiteLocked({})).toBe(false);
    expect(isSiteLocked({ VERCEL_ENV: "preview", SITE_LOCKED: "true" })).toBe(true);
  });
});

describe("decideAccess", () => {
  it("asks for the preview password on every page while locked, and accepts preview or admin credentials", () => {
    for (const path of ["/", "/events/x", "/api/anything", "/_next/image"]) {
      expect(decideAccess(path, null, PROD)).toEqual({ allow: false, status: 401, realm: PREVIEW_REALM, noindex: true });
    }
    expect(decideAccess("/", basic("friend", "preview-pass"), PROD)).toEqual({ allow: true, noindex: true });
    expect(decideAccess("/", basic("owner", "admin-pass"), PROD)).toEqual({ allow: true, noindex: true });
    expect(decideAccess("/", basic("friend", "wrong"), PROD)).toMatchObject({ allow: false, status: 401 });
    expect(decideAccess("/", basic("Friend", "preview-pass"), PROD)).toMatchObject({ allow: false });
  });

  it("keeps /admin on the admin credentials only, locked or not", () => {
    for (const env of [PROD, { ...PROD, SITE_LOCKED: "false" }]) {
      expect(decideAccess("/admin", basic("friend", "preview-pass"), env)).toEqual({ allow: false, status: 401, realm: ADMIN_REALM, noindex: true });
      expect(decideAccess("/admin/agent-log", null, env)).toMatchObject({ allow: false, realm: ADMIN_REALM });
      expect(decideAccess("/api/admin/rollback", basic("owner", "admin-pass"), env)).toEqual({ allow: true, noindex: true });
    }
    // "/administrator" isn't the admin area.
    expect(decideAccess("/administrator", basic("friend", "preview-pass"), PROD)).toEqual({ allow: true, noindex: true });
  });

  it("leaves /bot, /robots.txt, cron routes, and static build files public, still noindex while locked", () => {
    for (const path of ["/bot", "/bot/", "/robots.txt", "/api/cron/fetch", "/_next/static/chunks/a.js", "/favicon.ico"]) {
      expect(decideAccess(path, null, PROD)).toEqual({ allow: true, noindex: true });
    }
    expect(decideAccess("/bots", null, PROD)).toMatchObject({ allow: false });
  });

  it("fails closed when credentials aren't configured", () => {
    expect(decideAccess("/", basic("x", "y"), { VERCEL_ENV: "production" })).toMatchObject({ allow: false, status: 503 });
    expect(decideAccess("/admin", null, { VERCEL_ENV: "production", SITE_LOCKED: "false" })).toMatchObject({ allow: false, status: 503 });
    // Empty credentials never match empty settings.
    expect(decideAccess("/", basic("", ""), { ...PROD, SITE_PREVIEW_USER: "", SITE_PREVIEW_PASSWORD: "" })).toMatchObject({ allow: false, status: 503 });
  });

  it("opens the site once unlocked, indexable in production only", () => {
    expect(decideAccess("/", null, { ...PROD, SITE_LOCKED: "false" })).toEqual({ allow: true, noindex: false });
    expect(decideAccess("/", null, { VERCEL_ENV: "preview" })).toEqual({ allow: true, noindex: true });
    expect(decideAccess("/", null, {})).toEqual({ allow: true, noindex: true });
  });
});

describe("isAdminAuthorization", () => {
  it("accepts only the admin login, and nothing when admin isn't configured", () => {
    expect(isAdminAuthorization(basic("owner", "admin-pass"), PROD)).toBe(true);
    expect(isAdminAuthorization(basic("friend", "preview-pass"), PROD)).toBe(false);
    expect(isAdminAuthorization(null, PROD)).toBe(false);
    expect(isAdminAuthorization(basic("", ""), {})).toBe(false);
  });
});

describe("parseBasicAuth", () => {
  it("parses user:password, keeping colons in the password", () => {
    expect(parseBasicAuth(basic("a", "b:c"))).toEqual({ user: "a", password: "b:c" });
    expect(parseBasicAuth("Bearer xyz")).toBeNull();
    expect(parseBasicAuth(null)).toBeNull();
    expect(parseBasicAuth(`Basic ${Buffer.from("nocolon").toString("base64")}`)).toBeNull();
  });
});
