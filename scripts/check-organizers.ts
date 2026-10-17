/**
 * Checks each Tier 2 organizer against its own site (docs/product/organizers.md)
 * and writes data/organizers.check.json, which the seed applies (logged).
 * Per organizer: robots.txt for each host, then the home page, which must name
 * the organizer. Redirects are followed by hand, with robots.txt checked for
 * any new host. One request at a time, 2 s apart, honest user agent. A block
 * stops that site for good (recorded; never retried another way). Nothing from
 * a page is stored except whether it names the organizer and the address of
 * its events page.
 *
 * Usage: npm run organizers:check [-- --only slug1,slug2]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { botFetch, FetchBlockedError, FetchNotPermittedError } from "@/lib/http/fetch";
import { isAllowed, parseRobots, type RobotsRules } from "@/lib/http/robots";
import { type CheckAttempt, type CheckFile, defaultNameWords, eventsLink, namesOrganizer, type OrganizerCheck, pageText } from "@/lib/organizers/check";
import { ORGANIZER_SEEDS } from "@/lib/organizers/seed-data";
import { chicagoDate, formatDate } from "@/lib/time";

const OUT = "data/organizers.check.json";
const DELAY_MS = 2000;
const TIMEOUT_MS = 15_000;
const { values: args } = parseArgs({ options: { only: { type: "string" } } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;
async function politeFetch(url: string) {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  return botFetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
}

// Per host: the parsed rules, "blocked", or "unreachable" (no robots.txt answer: don't fetch).
const robotsByHost = new Map<string, RobotsRules | "blocked" | "unreachable">();
const robotsWhy = new Map<string, string>();
async function robotsFor(origin: URL): Promise<RobotsRules | "blocked" | "unreachable"> {
  const known = robotsByHost.get(origin.host);
  if (known) return known;
  let result: RobotsRules | "blocked" | "unreachable";
  try {
    let target = new URL("/robots.txt", origin);
    let res = await politeFetch(target.toString());
    // Follow up to 5 redirects (RFC 9309), each request through botFetch.
    for (let hop = 0; hop < 5 && res.status >= 300 && res.status < 400 && res.headers.get("location"); hop++) {
      target = new URL(res.headers.get("location")!, target);
      res = await politeFetch(target.toString());
    }
    // 4xx (not a block status) means no robots.txt: everything allowed (RFC 9309).
    if (res.status >= 400 && res.status < 500) result = parseRobots("");
    else if (res.ok) result = parseRobots(await res.text());
    // 5xx or a redirect loop: treat as disallowed for now (RFC 9309).
    else {
      result = "unreachable";
      robotsWhy.set(origin.host, `robots.txt answered HTTP ${res.status}`);
    }
  } catch (err) {
    result = err instanceof FetchBlockedError || err instanceof FetchNotPermittedError ? "blocked" : "unreachable";
    const e = err as Error & { cause?: { code?: string } };
    if (result === "unreachable") robotsWhy.set(origin.host, e.name === "TimeoutError" ? "robots.txt timed out" : `robots.txt: ${e.cause?.code ?? e.message}`.slice(0, 120));
    if (result === "blocked") console.log(`  robots.txt on ${origin.host}: ${(err as Error).message}`);
  }
  robotsByHost.set(origin.host, result);
  return result;
}

async function tryUrl(start: string, words: string[]): Promise<{ attempt: CheckAttempt; website?: string; eventsPage?: string | null }> {
  let url = new URL(start);
  for (let hop = 0; hop < 4; hop++) {
    const robots = await robotsFor(url);
    if (robots === "blocked") return { attempt: { url: start, result: "blocked", detail: `robots.txt on ${url.host} refused us` } };
    if (robots === "unreachable") return { attempt: { url: start, result: "unreachable", detail: robotsWhy.get(url.host) ?? `no robots.txt answer from ${url.host}` } };
    if (!isAllowed(robots, url.pathname + url.search)) return { attempt: { url: start, result: "robots_disallowed", detail: `${url.host}${url.pathname}` } };
    let res: Response;
    try {
      res = await politeFetch(url.toString());
    } catch (err) {
      if (err instanceof FetchBlockedError || err instanceof FetchNotPermittedError) {
        robotsByHost.set(url.host, "blocked");
        return { attempt: { url: start, result: "blocked", detail: err.message } };
      }
      return { attempt: { url: start, result: "unreachable", detail: (err as Error).name === "TimeoutError" ? "timed out" : String((err as Error).message).slice(0, 120) } };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) return { attempt: { url: start, result: "unreachable", detail: `HTTP ${res.status}` } };
    if (!(res.headers.get("content-type") ?? "").includes("html")) return { attempt: { url: start, result: "not_html" } };
    const html = await res.text();
    if (!namesOrganizer(pageText(html), words)) return { attempt: { url: start, result: "name_not_found", detail: `final page ${url.toString()}` } };
    return { attempt: { url: start, result: "confirmed" }, website: url.toString(), eventsPage: eventsLink(html, url.toString()) };
  }
  return { attempt: { url: start, result: "unreachable", detail: "too many redirects" } };
}

async function main() {
  const only = args.only ? new Set(args.only.split(",")) : null;
  const previous: CheckFile | null = await import("node:fs/promises").then((fs) => fs.readFile(OUT, "utf8").then((t) => JSON.parse(t) as CheckFile).catch(() => null));
  const results: Record<string, OrganizerCheck> = only && previous ? { ...previous.results } : {};
  for (const o of ORGANIZER_SEEDS) {
    if (only && !only.has(o.slug)) continue;
    if (o.noFetch || o.urls.length === 0) {
      results[o.slug] = { outcome: "not_fetched", website: null, eventsPage: null, tried: [], note: o.noFetch ?? "no address found" };
      continue;
    }
    const words = o.nameWords ?? defaultNameWords(o.name);
    const tried: CheckAttempt[] = [];
    let found: OrganizerCheck | null = null;
    for (const url of o.urls) {
      const r = await tryUrl(url, words);
      tried.push(r.attempt);
      if (r.website) {
        found = { outcome: "confirmed", website: r.website, eventsPage: r.eventsPage ?? null, tried };
        break;
      }
      // A block stops that site; the next address may be another site.
      if (r.attempt.result === "blocked") continue;
    }
    const last = tried.at(-1)?.result;
    results[o.slug] = found ?? {
      outcome: tried.some((t) => t.result === "blocked") ? "blocked" : last === "robots_disallowed" ? "robots_disallowed" : last === "name_not_found" || last === "not_html" ? "not_confirmed" : "unreachable",
      website: null,
      eventsPage: null,
      tried,
    };
    console.log(`${o.slug}: ${results[o.slug].outcome}${found?.eventsPage ? ` (events: ${found.eventsPage})` : ""}`);
  }
  const file: CheckFile = { checkedAt: formatDate(chicagoDate(new Date())), results };
  await writeFile(OUT, `${JSON.stringify(file, null, 2)}\n`);
  const counts = Object.values(results).reduce<Record<string, number>>((n, r) => ({ ...n, [r.outcome]: (n[r.outcome] ?? 0) + 1 }), {});
  console.log(`Wrote ${OUT}:`, counts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
