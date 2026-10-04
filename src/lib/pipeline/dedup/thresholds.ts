import { MERGE_MAX_START_DIFF_MIN } from "./score";

/**
 * Thresholds from the owner's labels (plan section 6, rule 7), pure:
 *   tMerge: the lowest score at which no labeled "different" pair would
 *           auto-merge, plus a 0.03 margin. Only "different" pairs that could
 *           auto-merge at all count: starts within 30 minutes, no room
 *           difference, no shared Ticketmaster ID (that one is always certain).
 *   tLlm:   no labeled "same" pair may fall below it: the lowest "same"
 *           score, but never above the current value (only ever lowered).
 * Without labels of a kind, the current value stays, and the reason says so.
 */

export interface LabeledScore {
  label: "same" | "different";
  score: number;
  startDiffMinutes: number;
  subSpaceDiffers?: boolean;
  ticketmasterIdMatch: boolean;
}

export const MERGE_MARGIN = 0.03;
const round = (n: number) => Math.round(n * 1000) / 1000;

export function computeThresholds(labels: readonly LabeledScore[], current: { tMerge: number; tLlm: number }) {
  const mergeable = labels.filter(
    (l) => l.label === "different" && !l.ticketmasterIdMatch && !l.subSpaceDiffers && l.startDiffMinutes <= MERGE_MAX_START_DIFF_MIN,
  );
  const same = labels.filter((l) => l.label === "same");
  const worstDifferent = mergeable.length ? Math.max(...mergeable.map((l) => l.score)) : null;
  const lowestSame = same.length ? Math.min(...same.map((l) => l.score)) : null;

  // A "different" pair at score s auto-merges when s >= tMerge, so tMerge must exceed s: s plus the margin.
  const tMerge = worstDifferent === null ? current.tMerge : round(Math.max(current.tMerge, worstDifferent + MERGE_MARGIN));
  const tLlm = lowestSame === null ? current.tLlm : round(Math.min(current.tLlm, lowestSame));
  return {
    tMerge,
    tLlm,
    reasons: {
      tMerge:
        worstDifferent === null
          ? `no labeled "different" pair could auto-merge; keeping ${current.tMerge}`
          : `highest auto-mergeable "different" pair scores ${worstDifferent}; plus ${MERGE_MARGIN}${tMerge === current.tMerge ? `, already below ${current.tMerge}, so it stays` : ""}`,
      tLlm: lowestSame === null ? `no "same" labels yet; keeping ${current.tLlm}` : `lowest "same" pair scores ${lowestSame}${tLlm === current.tLlm ? `, at or above ${current.tLlm}, so it stays` : ""}`,
    },
    // Never set the merge threshold at or above 1: a perfect title match must still be able to merge.
    warnings: tMerge >= 1 ? ["a labeled \"different\" pair has a perfect title score: merging by title alone is unsafe for it; check that pair"] : [],
    counts: { labels: labels.length, same: same.length, different: labels.length - same.length, mergeableDifferent: mergeable.length },
  };
}
