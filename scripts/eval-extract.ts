/**
 * Live eval of the LLM stages on committed fixtures (plan build step 13):
 *   - classification accuracy on tests/fixtures/eval/events.json
 *   - injection resistance on tests/fixtures/injection/listings.json
 * Makes real model calls (cost is reported; a few cents). Fixtures hold only
 * facts and descriptions written for them, never source text.
 *
 * Usage: npm run eval:extract
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { readFileSync } from "node:fs";
import { eq, sum } from "drizzle-orm";
import { loadActiveTaxonomy } from "@/lib/categories";
import { getDb } from "@/lib/db/client";
import { llmCalls } from "@/lib/db/schema";
import { generateStructured } from "@/lib/llm";
import { classifyEvent } from "@/lib/pipeline/enrich/classify";
import { describeEvent, newAges } from "@/lib/pipeline/enrich/describe";
import { extractFacts } from "@/lib/pipeline/enrich/extract";
import type { Generate } from "@/lib/pipeline/enrich/types";
import type { Facts } from "@/lib/pipeline/map";
import { startRun, finishRun } from "@/lib/runs";

interface EvalCase { title: string; venue: string; venueType: string; sourceCategories: string[]; performers: string[]; description: string | null; accept: string[] }
interface InjectionCase {
  id: string; title: string; venueName: string; venueType: string; description: string;
  expect: { categoryNot?: string[]; tagsNot?: string[]; isFree?: boolean; priceMin?: number; ageRestrictionNot?: string[]; descriptionNot?: string[] };
}

const facts = (title: string, extra: Partial<Facts> = {}): Facts => ({
  title, startAt: "2026-10-20T00:00:00.000Z", endAt: null, allDay: false, timeTba: false, status: "scheduled", sourceUrl: null, ticketUrl: null,
  location: { text: null, name: null, room: null, street: null, city: null, externalVenueId: null },
  price: { min: null, max: null, currency: null }, performers: [], sourceCategories: [], legalAgeEnforced: null, recurrence: null,
  timezoneAssumed: false, ...extra,
});

async function main() {
  const db = getDb();
  const run = await startRun(db, "manual");
  const generate = ((req) => generateStructured({ ...req, runId: run.id }, { db })) as Generate;
  const taxonomy = await loadActiveTaxonomy(db);
  try {
    const evalSet = JSON.parse(readFileSync("tests/fixtures/eval/events.json", "utf8")).cases as EvalCase[];
    let correct = 0;
    console.log("Classification:");
    for (const c of evalSet) {
      const f = facts(c.title, { performers: c.performers, sourceCategories: c.sourceCategories });
      const extraction = c.description ? (await extractFacts(generate, f, c.description, run.id)).data : null;
      const r = await classifyEvent(generate, { facts: f, venueName: c.venue, venueType: c.venueType, extraction, description: c.description }, taxonomy, run.id);
      const ok = c.accept.includes(r.data.category);
      if (ok) correct++;
      const hint = r.data.closestMissingCategory ? ` (closest missing: ${r.data.closestMissingCategory})` : "";
      console.log(`  ${ok ? "ok  " : "MISS"} ${c.title.slice(0, 50).padEnd(50)} → ${r.data.category}${hint} [${r.data.tags.join(", ")}]${ok ? "" : `  expected one of: ${c.accept.join(", ")}`}`);
    }
    console.log(`  accuracy: ${correct}/${evalSet.length} (${Math.round((100 * correct) / evalSet.length)}%)\n`);

    const injections = JSON.parse(readFileSync("tests/fixtures/injection/listings.json", "utf8")).cases as InjectionCase[];
    let resisted = 0;
    console.log("Injection fixtures:");
    for (const c of injections) {
      const f = facts(c.title);
      const extraction = (await extractFacts(generate, f, c.description, run.id)).data;
      const cls = (await classifyEvent(generate, { facts: f, venueName: c.venueName, venueType: c.venueType, extraction, description: c.description }, taxonomy, run.id)).data;
      const desc = await describeEvent(generate, { title: c.title, when: "Tuesday, October 20, 7:00 PM", venue: c.venueName, city: "Fayetteville", category: cls.category, price: null, tags: [], performers: [], ages: newAges(c.title, extraction), activity: extraction.activity, registrationRequired: extraction.registrationRequired }, c.description, run.id);
      const text = desc.status === "ok" ? desc.description : "";
      const fails: string[] = [];
      const e = c.expect;
      if (e.categoryNot?.includes(cls.category)) fails.push(`category ${cls.category}`);
      for (const t of e.tagsNot ?? []) if (cls.tags.includes(t)) fails.push(`tag ${t}`);
      if (e.isFree !== undefined && extraction.isFree !== e.isFree) fails.push(`isFree ${extraction.isFree}`);
      if (e.priceMin !== undefined && extraction.priceMin !== e.priceMin) fails.push(`priceMin ${extraction.priceMin}`);
      if (e.ageRestrictionNot?.includes(extraction.ageRestriction ?? "")) fails.push(`age ${extraction.ageRestriction}`);
      for (const s of e.descriptionNot ?? []) if (text.toLowerCase().includes(s.toLowerCase())) fails.push(`description mentions "${s}"`);
      if (fails.length === 0) resisted++;
      console.log(`  ${fails.length ? "STEERED" : "ok     "} ${c.id.padEnd(22)} category=${cls.category} free=${extraction.isFree} priceMin=${extraction.priceMin} age=${extraction.ageRestriction}${fails.length ? `  ← ${fails.join("; ")}` : ""}`);
    }
    console.log(`  resisted: ${resisted}/${injections.length}\n`);

    const [{ cost }] = await db.select({ cost: sum(llmCalls.costUsd) }).from(llmCalls).where(eq(llmCalls.runId, run.id));
    console.log(`Cost: $${Number(cost ?? 0).toFixed(4)}`);
    await finishRun(db, run.id, { status: "ok", stats: { accuracy: correct / evalSet.length, resisted, injections: injections.length, costUsd: Number(cost ?? 0) } });
  } catch (err) {
    await finishRun(db, run.id, { status: "failed", error: String(err).slice(0, 2000) });
    throw err;
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
