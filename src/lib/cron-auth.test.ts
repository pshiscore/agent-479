import { describe, expect, it } from "vitest";
import { isAuthorizedCron } from "./cron-auth";

const SECRET = "s3cret-value-long-enough";
const req = (auth?: string) => new Request("https://example.org/api/cron/fetch", { headers: auth ? { authorization: auth } : {} });

describe("isAuthorizedCron", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedCron(req(`Bearer ${SECRET}`), SECRET)).toBe(true);
    expect(isAuthorizedCron(req(`Bearer ${SECRET}x`), SECRET)).toBe(false);
    expect(isAuthorizedCron(req(SECRET), SECRET)).toBe(false);
    expect(isAuthorizedCron(req(), SECRET)).toBe(false);
  });

  it("refuses everything when the secret is unset or too short", () => {
    expect(isAuthorizedCron(req("Bearer "), "")).toBe(false);
    expect(isAuthorizedCron(req("Bearer short"), "short")).toBe(false);
    expect(isAuthorizedCron(req("Bearer x"), undefined)).toBe(false);
  });
});
