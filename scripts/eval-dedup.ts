/**
 * The LLM band, checked against the owner's labels (plan section 6, rule 7):
 * for each labeled pair the engine would send to the model, ask the tiebreak
 * for real and compare. Makes real calls (pennies); run it when the prompt or
 * model changes. Calls are logged in the local database's llm_calls.
 *
 * Usage: npm run eval:dedup
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { readFileSync } from "node:fs";
import { DEDUP_THRESHOLDS } from "@/config/dedup";
import { getDb } from "@/lib/db/client";
import { generateStructured } from "@/lib/llm";
import type { Generate } from "@/lib/pipeline/enrich/types";
import { decideFromLlm, preDecide, scorePair } from "@/lib/pipeline/dedup/score";
import { tiebreak } from "@/lib/pipeline/dedup/tiebreak";

interface Side { title: string; startAt: string; endAt: string | null; allDay: boolean; timeTba: boolean; venue: string; subSpace: string | null; source: string; ticketUrl: string | null; sourceUrl: string | null }

async function main() {
  const { pairs } = JSON.parse(readFileSync("tests/fixtures/dedup/labels.json", "utf8")) as { pairs: { label: "same" | "different"; a: Side; b: Side }[] };
  const db = getDb();
  const generate = ((req) => generateStructured(req, { db })) as Generate;
  const t = { merge: DEDUP_THRESHOLDS.tMerge, llm: DEDUP_THRESHOLDS.tLlm };
  let asked = 0;
  let agree = 0;
  let wrongMerges = 0;
  try {
    for (const p of pairs) {
      const sc = (s: Side) => ({ title: s.title, startAt: new Date(s.startAt), ticketUrl: s.ticketUrl, sourceUrl: s.sourceUrl, subSpace: s.subSpace });
      if (preDecide(scorePair(sc(p.a), sc(p.b)), t) !== "llm") continue;
      asked++;
      const ts = (s: Side) => ({ title: s.title, startAt: new Date(s.startAt), endAt: s.endAt ? new Date(s.endAt) : null, allDay: s.allDay, timeTba: s.timeTba, venue: s.subSpace ? `${s.subSpace}, ${s.venue}` : s.venue, source: s.source, performers: [] });
      const r = await tiebreak(generate, ts(p.a), ts(p.b));
      const decision = decideFromLlm(r.data);
      const ok = p.label === "same" ? decision === "llm_same" : decision === "distinct";
      if (ok) agree++;
      if (p.label === "different" && decision === "llm_same") wrongMerges++;
      console.log(`${ok ? "ok  " : "MISS"} ${p.label.padEnd(9)} → ${decision.padEnd(9)} (${r.data.confidence})  "${p.a.title}" / "${p.b.title}"`);
    }
    console.log(`\n${asked} labeled pairs in the model's band: ${agree} agree with the owner; ${wrongMerges} would have merged two different events.`);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
