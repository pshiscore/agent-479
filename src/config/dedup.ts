/**
 * Dedup thresholds (plan section 6, rule 4). The starting values are
 * placeholders until the owner labels pairs in /admin/dedup-review; then:
 *   T_MERGE = the lowest score at which no labeled "different" pair would
 *             auto-merge, plus a 0.03 margin
 *   T_LLM   = low enough that no labeled "same" pair falls below it
 * (computeThresholds in src/lib/pipeline/dedup/thresholds.ts suggests them).
 * Changing a value is a code change, checked by tests/dedup-regression.test.ts.
 */
export const DEDUP_THRESHOLDS = {
  tMerge: 0.85,
  tLlm: 0.5,
  // "placeholder" until set from labels; then the date and label count.
  basis: "placeholder",
} as const;
