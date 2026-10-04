import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every env var the app reads must be documented in .env.example.
// Add new names here when code starts reading them.
const REQUIRED_KEYS = [
  "SITE_URL",
  "BOT_CONTACT_EMAIL",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "CRON_SECRET",
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD",
  "OPENAI_API_KEY",
  "LLM_DAILY_BUDGET_USD",
  "TICKETMASTER_API_KEY",
  "SITE_LOCKED",
  "SITE_PREVIEW_USER",
  "SITE_PREVIEW_PASSWORD",
  "CRON_ENABLED",
];

function parseKeys(contents: string): Map<string, string> {
  const keys = new Map<string, string>();
  for (const line of contents.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) keys.set(match[1], match[2]);
  }
  return keys;
}

describe(".env.example", () => {
  const keys = parseKeys(
    readFileSync(path.resolve(__dirname, "../.env.example"), "utf8"),
  );

  it.each(REQUIRED_KEYS)("documents %s", (key) => {
    expect(keys.has(key)).toBe(true);
  });

  it("contains no secret values", () => {
    const secretKeys = [
      "DATABASE_URL",
      "DATABASE_URL_UNPOOLED",
      "CRON_SECRET",
      "ADMIN_PASSWORD",
      "OPENAI_API_KEY",
      "TICKETMASTER_API_KEY",
      "SITE_PREVIEW_PASSWORD",
    ];
    for (const key of secretKeys) expect(keys.get(key)).toBe("");
  });

  it("names the site and the bot's public contact (owner, 2026-10-04)", () => {
    expect(keys.get("SITE_URL")).toBe("https://479.guide");
    expect(keys.get("BOT_CONTACT_EMAIL")).toBe("bot@479.guide");
  });

  it("does not configure model names (they live in llm_models)", () => {
    for (const key of keys.keys()) expect(key).not.toMatch(/MODEL/);
  });
});
