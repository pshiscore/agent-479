import { z } from "zod";
import { COMMUNITY_SLUG, type TaxonomyEntry } from "@/lib/categories";
import { wrapUntrusted } from "@/lib/llm";
import type { Facts } from "../map";
import type { Extraction } from "./extract";
import type { Generate } from "./types";

/**
 * Exactly one category and any tags, from the active rows only: both enums
 * are built at run time (plan section 5, rule 6). "Free", "21+",
 * "Registration required", "Ticketed", and "En español" are set in code from
 * the facts, so the model never chooses them. Picking Community requires a
 * closest-missing-category hint.
 */

export const CODE_SET_TAGS = new Set(["free", "21-plus", "registration-required", "ticketed", "en-espanol"]);
export const CLASSIFY_PROMPT_VERSION = "classify@2";

// What a tag means, where the name alone isn't enough.
const TAG_HINTS: Record<string, string> = { volunteer: "blood drives, cleanups, volunteer shifts" };

export interface Classification {
  category: string;
  tags: string[];
  closestMissingCategory: string | null;
}

export function classificationSchema(categories: TaxonomyEntry[], tags: TaxonomyEntry[]) {
  const catSlugs = categories.map((c) => c.slug) as [string, ...string[]];
  const tagSlugs = tags.map((t) => t.slug).filter((s) => !CODE_SET_TAGS.has(s)) as [string, ...string[]];
  return z.object({
    category: z.enum(catSlugs),
    tags: z.array(z.enum(tagSlugs)).max(6),
    closestMissingCategory: z.string().trim().max(60).nullable(),
  });
}

export interface ClassifyInput {
  facts: Facts;
  venueName: string;
  venueType: string;
  extraction: Extraction | null;
  description: string | null;
}

export async function classifyEvent(
  generate: Generate,
  input: ClassifyInput,
  taxonomy: { categories: TaxonomyEntry[]; tags: TaxonomyEntry[] },
  runId?: string | null,
): Promise<{ data: Classification; callId: string; model: string }> {
  const schema = classificationSchema(taxonomy.categories, taxonomy.tags);
  const cats = taxonomy.categories.map((c) => `- ${c.slug}: ${c.name}`).join("\n");
  const tags = taxonomy.tags
    .filter((t) => !CODE_SET_TAGS.has(t.slug))
    .map((t) => `- ${t.slug}: ${t.name}${TAG_HINTS[t.slug] ? ` (${TAG_HINTS[t.slug]})` : ""}`)
    .join("\n");
  const { facts } = input;
  const known = [
    `Title: ${facts.title}`,
    `Venue: ${input.venueName} (${input.venueType.replace("_", " ")})`,
    facts.performers.length ? `Performers: ${facts.performers.join(", ")}` : null,
    facts.sourceCategories.length ? `Source's own categories (a hint only): ${facts.sourceCategories.join(", ")}` : null,
    input.extraction?.familyFriendly ? "Stated as family-friendly." : null,
  ]
    .filter(Boolean)
    .join("\n");
  const result = await generate({
    task: "classify",
    schema,
    schemaName: "event_classification",
    system: [
      "Classify a local event for a Northwest Arkansas events calendar.",
      `Choose exactly one category:\n${cats}`,
      `Choose any tags that clearly apply (often none):\n${tags}`,
      `Use "${COMMUNITY_SLUG}" only when no other category fits. When you choose it, set closestMissingCategory to a short name for the category that would have fit (for example "Library programs"); otherwise set it to null.`,
    ].join("\n\n"),
    input: input.description ? `${known}\n\n${wrapUntrusted("event listing", input.description, 4_000)}` : known,
    promptVersion: CLASSIFY_PROMPT_VERSION,
    runId,
  });
  const d = result.data;
  return {
    data: {
      category: d.category,
      tags: [...new Set(d.tags)],
      // Only Community carries a hint; a missing one is recorded as unknown.
      closestMissingCategory: d.category === COMMUNITY_SLUG ? (d.closestMissingCategory ?? "unknown") : null,
    },
    callId: result.callId,
    model: result.model,
  };
}
