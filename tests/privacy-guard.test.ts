import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// /privacy says we run no analytics and set no cookies. If either becomes
// untrue, update the page first (docs/PREDEPLOY_CHECKLIST.md, Privacy), then
// change this test.
const root = path.resolve(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });

describe("privacy page stays true", () => {
  it("no analytics packages", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /analytics|speed-insights|gtag|posthog|segment|mixpanel|plausible|umami/i.test(d))).toEqual([]);
  });

  it("no analytics scripts or cookies set in app code", () => {
    const hits = files(path.join(root, "src")).filter((f) =>
      /_vercel\/insights|speed-insights|googletagmanager|google-analytics|document\.cookie|cookies\(\)\.set|Set-Cookie/i.test(readFileSync(f, "utf8")),
    );
    expect(hits.map((f) => path.relative(root, f))).toEqual([]);
  });
});
