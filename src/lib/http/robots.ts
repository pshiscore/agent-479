/**
 * robots.txt per RFC 9309. Rules come from the group naming our product token
 * ("Agent479Bot"), or the "*" group if none does. The longest matching rule
 * wins, and Allow wins a tie. "*" matches any run of characters and "$"
 * anchors the end. Crawl-delay isn't in the RFC, but we honor it when present.
 */

export const ROBOTS_PRODUCT_TOKEN = "agent479bot";

interface Rule {
  allow: boolean;
  pattern: string;
}

export interface RobotsRules {
  rules: Rule[];
  crawlDelaySeconds: number | null;
}

interface Group {
  agents: string[];
  rules: Rule[];
  crawlDelaySeconds: number | null;
}

export function parseRobots(text: string, token = ROBOTS_PRODUCT_TOKEN): RobotsRules {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      // Consecutive User-agent lines share one group.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelaySeconds: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      // An empty Disallow means "allow everything" and adds no rule.
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelaySeconds = n;
    }
  }

  const ours = groups.filter((g) => g.agents.includes(token.toLowerCase()));
  const chosen = ours.length > 0 ? ours : groups.filter((g) => g.agents.includes("*"));
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelaySeconds: chosen.reduce<number | null>(
      (max, g) => (g.crawlDelaySeconds === null ? max : Math.max(max ?? 0, g.crawlDelaySeconds)),
      null,
    ),
  };
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Percent-decodes unreserved characters only, so "/a%2Fb" and "/a/b" stay different. */
function normalizePath(p: string): string {
  return p.replace(/%([0-9A-Fa-f]{2})/g, (whole, hex: string) => {
    const c = String.fromCharCode(Number.parseInt(hex, 16));
    return /[A-Za-z0-9\-._~]/.test(c) ? c : whole.toUpperCase();
  });
}

/** Whether we may fetch `pathAndQuery` (e.g. "/calendar?x=1"). */
export function isAllowed(rules: RobotsRules, pathAndQuery: string): boolean {
  const path = normalizePath(pathAndQuery || "/");
  let best: Rule | null = null;
  for (const rule of rules.rules) {
    if (!patternToRegExp(normalizePath(rule.pattern)).test(path)) continue;
    const longer = !best || rule.pattern.length > best.pattern.length;
    const tieAllow = best && rule.pattern.length === best.pattern.length && rule.allow;
    if (longer || tieAllow) best = rule;
  }
  return best ? best.allow : true;
}
