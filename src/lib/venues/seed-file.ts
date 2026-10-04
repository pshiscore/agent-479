import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { VENUE_TYPES } from "@/lib/db/schema";

/**
 * Format of data/venues.seed.json: hand-verified venues with per-field
 * provenance. `reviewed` records the owner's sign-off on the exact contents,
 * and the seed script refuses to run unless its sha256 still matches.
 */

const isoDate = z.iso.date();

/**
 * Where a value came from. By default a tool read it at `url`. When a site
 * can't be read by a tool (client-side rendering, or it refused us), the owner
 * checks it in their own browser: `verifiedBy: "owner"` plus what they confirmed.
 */
export const provenanceSchema = z
  .strictObject({
    // Optional only for owner-verified values the owner gave without a page.
    url: z.url({ protocol: /^https?$/ }).optional(),
    checkedAt: isoDate,
    note: z.string().min(1).optional(),
    verifiedBy: z.literal("owner").optional(),
    confirmed: z.string().trim().min(5).optional(),
  })
  .refine((p) => (p.verifiedBy === "owner") === (p.confirmed !== undefined), {
    message: 'owner-verified sources need "confirmed" (what the owner saw), and only they have it',
  })
  .refine((p) => p.url !== undefined || p.verifiedBy === "owner", {
    message: "a source needs a url unless the owner verified it",
  });

export const handCheckSchema = z.strictObject({
  finding: z.string().trim().min(10),
  url: z.url({ protocol: /^https?$/ }),
  checkedAt: isoDate,
});

// Six decimals is ~0.1 m and matches numeric(9,6) in the database.
const coord = (min: number, max: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .refine((n) => Math.abs(n * 1e6 - Math.round(n * 1e6)) < 1e-6, "at most 6 decimal places");

export const seedVenueSchema = z
  .strictObject({
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug must be kebab-case"),
    name: z.string().trim().min(2),
    aliases: z.array(z.string().trim().min(2)).default([]),
    venueType: z.enum(VENUE_TYPES),
    address: z.string().trim().min(3).nullable().default(null),
    // Earlier street addresses other sources may still use; for matching only.
    formerAddresses: z.array(z.string().trim().min(3)).default([]),
    city: z.string().trim().min(2),
    state: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default("AR"),
    postalCode: z
      .string()
      .regex(/^\d{5}$/)
      .nullable()
      .default(null),
    lat: coord(-90, 90),
    lng: coord(-180, 180),
    website: z.url({ protocol: /^https$/ }).nullable().default(null),
    parent: z.string().nullable().default(null),
    verification: z.strictObject({
      name: provenanceSchema,
      address: provenanceSchema.optional(),
      formerAddresses: provenanceSchema.optional(),
      postalCode: provenanceSchema.optional(),
      location: provenanceSchema,
      website: provenanceSchema.optional(),
    }),
    notes: z.string().optional(),
    // What a person checked to accept a warning, shown next to it in the report.
    // Hand checks explain warnings; they never clear an error.
    handChecks: z.array(handCheckSchema).default([]),
  })
  .superRefine((v, ctx) => {
    const issue = (path: string[], message: string) => ctx.addIssue({ code: "custom", path, message });
    if (v.venueType !== "area" && !v.address) issue(["address"], "only area venues may omit address");
    if (v.address && !v.verification.address) {
      issue(["verification", "address"], "address needs provenance");
    }
    if (v.postalCode && !v.verification.postalCode && !v.verification.address) {
      issue(["verification", "postalCode"], "postal code needs provenance");
    }
    if (v.formerAddresses.length > 0 && !v.verification.formerAddresses) {
      issue(["verification", "formerAddresses"], "former addresses need provenance");
    }
    if (v.website && !v.verification.website) {
      issue(["verification", "website"], "website needs provenance");
    }
    if (v.parent === v.slug) issue(["parent"], "a venue can't be its own parent");
  });

export const seedFileSchema = z.strictObject({
  $comment: z.string().optional(),
  reviewed: z
    .strictObject({ by: z.string().min(1), at: isoDate, sha256: z.string().regex(/^[0-9a-f]{64}$/) })
    .nullable(),
  venues: z.array(seedVenueSchema),
});

export type SeedVenue = z.output<typeof seedVenueSchema>;
export type SeedFile = z.output<typeof seedFileSchema>;

/** JSON with object keys sorted, so the hash ignores key order and whitespace. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Hash of the parsed venues: what the owner signs off on in `reviewed.sha256`. */
export function venuesHash(venues: readonly SeedVenue[]): string {
  return createHash("sha256").update(canonicalJson(venues)).digest("hex");
}

/** Reads and validates a seed file. Throws a ZodError listing every problem. */
export async function readSeedFile(path: string): Promise<SeedFile> {
  return seedFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
}
