import { describe, expect, it } from "vitest";
import { applyLinkPolicy, type LinkPolicy, normalizeDomain, policyFor } from "./links";

const POLICIES: LinkPolicy[] = [
  { domain: "crystalbridges.org", mode: "homepage_only", homepageUrl: "https://crystalbridges.org/" },
  { domain: "themomentary.org", mode: "homepage_only", homepageUrl: "https://themomentary.org/" },
  { domain: "example.org", mode: "deep", homepageUrl: null },
];

describe("applyLinkPolicy", () => {
  it("rewrites deep links on homepage-only domains, including subdomains", () => {
    expect(applyLinkPolicy("https://crystalbridges.org/calendar/event/jazz-night/", POLICIES)).toBe(
      "https://crystalbridges.org/",
    );
    expect(applyLinkPolicy("https://www.crystalbridges.org/visit?x=1", POLICIES)).toBe("https://crystalbridges.org/");
    expect(applyLinkPolicy("http://tickets.themomentary.org/e/123", POLICIES)).toBe("https://themomentary.org/");
  });

  it("leaves other domains alone, with or without a policy row", () => {
    expect(applyLinkPolicy("https://example.org/events/1", POLICIES)).toBe("https://example.org/events/1");
    expect(applyLinkPolicy("https://www.waltonartscenter.org/events/x", POLICIES)).toBe(
      "https://www.waltonartscenter.org/events/x",
    );
  });

  it("doesn't match lookalike domains", () => {
    expect(policyFor("notcrystalbridges.org", POLICIES)).toBeUndefined();
    expect(policyFor("crystalbridges.org.evil.example", POLICIES)).toBeUndefined();
  });

  it("returns null for anything that isn't an http(s) URL", () => {
    expect(applyLinkPolicy("javascript:alert(1)", POLICIES)).toBeNull();
    expect(applyLinkPolicy("not a url", POLICIES)).toBeNull();
    expect(applyLinkPolicy("mailto:a@example.org", POLICIES)).toBeNull();
  });
});

describe("normalizeDomain", () => {
  it.each([
    ["crystalbridges.org", "crystalbridges.org"],
    ["CrystalBridges.ORG", "crystalbridges.org"],
    ["www.crystalbridges.org", "crystalbridges.org"],
    ["crystalbridges.org.", "crystalbridges.org"],
    ["crystalbridges.org:443", "crystalbridges.org"],
    ["  WWW.CrystalBridges.org.:8080  ", "crystalbridges.org"],
    ["https://www.crystalbridges.org/calendar?x=1", "crystalbridges.org"],
    ["tickets.themomentary.org", "tickets.themomentary.org"],
    ["www.org", "www.org"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each(["", "localhost", "not a domain", "https://", "javascript:alert(1)"])("rejects %j", (input) => {
    expect(normalizeDomain(input)).toBeNull();
  });

  it("makes lookups match however the host is written", () => {
    expect(policyFor("WWW.CRYSTALBRIDGES.ORG.", POLICIES)?.domain).toBe("crystalbridges.org");
  });
});
