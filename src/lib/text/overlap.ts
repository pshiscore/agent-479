/**
 * Our summaries must be our own words (AGENTS.md rule 4). This finds the
 * longest run of consecutive words a summary shares with the source's
 * description, ignoring case and punctuation. A run of 8 or more words means
 * the summary reused source wording: regenerate it or hold it for review.
 */

export const MAX_SHARED_WORDS = 7;

function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** The longest run of consecutive words found in both texts (longest common substring over words). */
export function longestSharedRun(a: string, b: string): string[] {
  const x = words(a);
  const y = words(b);
  if (x.length === 0 || y.length === 0) return [];
  let best = 0;
  let bestEnd = 0;
  let prev = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) {
      if (x[i - 1] === y[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) {
          best = cur[j];
          bestEnd = i;
        }
      }
    }
    prev = cur;
  }
  return x.slice(bestEnd - best, bestEnd);
}

export interface OriginalityCheck {
  ok: boolean;
  // The shared run that failed the check, if any.
  sharedRun: string | null;
}

/** Fails when the summary shares 8 or more consecutive words with the description. */
export function checkOriginalWording(summary: string, sourceDescription: string | null): OriginalityCheck {
  if (!sourceDescription) return { ok: true, sharedRun: null };
  const run = longestSharedRun(summary, sourceDescription);
  return run.length > MAX_SHARED_WORDS ? { ok: false, sharedRun: run.join(" ") } : { ok: true, sharedRun: null };
}
