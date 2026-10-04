/**
 * Runs the content checks (evaluative words; grounding, with the glossary)
 * over every stored description, read-only, and reports what they'd flag,
 * with each flagged event's facts beside it. Also lists acronym expansions
 * the glossary doesn't have.
 *
 * Usage: npm run check:descriptions
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { getDb } from "@/lib/db/client";
import { factsForChecks } from "@/lib/pipeline/enrich/describe";
import { storedEvents } from "@/lib/pipeline/enrich/stored-facts";
import { contentIssues, describeIssues, unknownExpansions } from "@/lib/text/checks";

async function main() {
  const db = getDb();
  try {
    const events = await storedEvents(db, { withDescription: true });
    const flagged = [];
    const candidates = new Map<string, string>();
    for (const e of events) {
      const facts = factsForChecks(e.facts);
      for (const c of unknownExpansions(e.description!, facts.text)) candidates.set(`${c.acronym} → ${c.expansion}`, e.title);
      const issues = contentIssues(e.description!, facts);
      if (issues) flagged.push({ e, facts: facts.text, issues });
    }
    const evaluative = flagged.filter((f) => f.issues.evaluative.length).length;
    const grounding = flagged.filter((f) => f.issues.ungrounded.length).length;
    console.log(`${events.length} descriptions checked: ${flagged.length} flagged (${evaluative} evaluative, ${grounding} grounding)\n`);
    for (const f of flagged) {
      console.log(`- ${f.e.title}  [${f.e.eventId}]`);
      console.log(`    description: "${f.e.description}"`);
      console.log(`    flagged:     ${describeIssues(f.issues)}`);
      console.log(`    facts:       ${f.facts}`);
    }
    console.log(`\nExpansions not in the glossary: ${candidates.size ? [...candidates].map(([k, t]) => `${k} (in "${t}")`).join("; ") : "none"}`);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
