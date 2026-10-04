/**
 * Checks data/venues.seed.json and writes the verification report the owner
 * signs off on before seeding (build step 6).
 *
 * Usage:
 *   npm run venues:verify               offline checks only
 *   npm run venues:verify -- --geocode  also cross-check every address with
 *                                       the US Census geocoder (needs
 *                                       BOT_CONTACT_EMAIL in .env.local)
 *
 * Writes data/venues.report.md. Exits non-zero if any check is an error.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });

import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { botUserAgent } from "@/lib/bot-identity";
import { FetchBlockedError } from "@/lib/http/fetch";
import { censusGeocode } from "@/lib/venues/geocode";
import { readSeedFile, type SeedVenue, venuesHash } from "@/lib/venues/seed-file";
import {
  checkGeocode,
  checkVenues,
  distanceMeters,
  GEOCODE_LIMITS,
  type VenueIssue,
} from "@/lib/venues/verify";

// Census geocoder has no published rate limit; stay gentle anyway.
const GEOCODE_DELAY_MS = 500;

const { values: args } = parseArgs({
  options: {
    file: { type: "string", default: "data/venues.seed.json" },
    out: { type: "string", default: "data/venues.report.md" },
    geocode: { type: "boolean", default: false },
  },
});

const cell = (s: string | null | undefined) => (s ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
const osm = (v: SeedVenue) =>
  `[${v.lat}, ${v.lng}](https://www.openstreetmap.org/?mlat=${v.lat}&mlon=${v.lng}#map=18/${v.lat}/${v.lng})`;
const oneLine = (v: SeedVenue) =>
  [v.address, v.city, `${v.state}${v.postalCode ? ` ${v.postalCode}` : ""}`].filter(Boolean).join(", ");

async function main() {
  const file = await readSeedFile(args.file).catch((err) => {
    if (err instanceof z.ZodError) {
      console.error(`${args.file} is invalid:\n${z.prettifyError(err)}`);
      process.exit(1);
    }
    throw err;
  });
  const today = new Date();
  const issues: VenueIssue[] = checkVenues(file.venues, today);
  const geocodeDistance = new Map<string, number | null>();

  if (args.geocode) {
    const userAgent = botUserAgent();
    const toGeocode = file.venues.filter((v) => v.address);
    for (const [i, v] of toGeocode.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, GEOCODE_DELAY_MS));
      process.stdout.write(`geocoding ${i + 1}/${toGeocode.length} ${v.slug}\r`);
      try {
        const match = await censusGeocode(oneLine(v), { userAgent });
        geocodeDistance.set(v.slug, match ? Math.round(distanceMeters(v, match)) : null);
        issues.push(...checkGeocode(v, match));
      } catch (err) {
        // A block means stop: no retry, no workaround, no partial report.
        if (err instanceof FetchBlockedError) {
          console.error(`\n${err.message}`);
          process.exit(1);
        }
        issues.push({ slug: v.slug, level: "warning", message: `geocoder failed: ${String(err)}` });
      }
    }
    process.stdout.write("\n");
  }

  const hash = venuesHash(file.venues);
  const handChecksBySlug = new Map(file.venues.map((v) => [v.slug, v.handChecks]));
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const signOff = !file.reviewed
    ? "**Not signed off.**"
    : file.reviewed.sha256 === hash
      ? `Signed off by ${file.reviewed.by} on ${file.reviewed.at}, and the contents still match.`
      : `**Changed since sign-off** by ${file.reviewed.by} on ${file.reviewed.at}. Review again.`;

  const lines = [
    "# Venue verification report",
    "",
    `Generated ${today.toISOString()} from \`${args.file}\`.`,
    "",
    `- Venues: ${file.venues.length}`,
    `- Errors: ${errors.length}, warnings: ${warnings.length}`,
    `- Geocoder cross-check: ${args.geocode ? `yes (warns above ${GEOCODE_LIMITS.default.warn} m, or ${GEOCODE_LIMITS.large.warn} m for parks and campuses)` : "**not run** (use --geocode)"}`,
    `- Contents sha256: \`${hash}\``,
    `- ${signOff}`,
    "",
    "## Issues",
    "",
    ...(issues.length === 0
      ? ["None."]
      : [...errors, ...warnings].flatMap((i) => [
          `- **${i.level}** \`${i.slug}\`: ${cell(i.message)}`,
          ...(handChecksBySlug.get(i.slug) ?? []).map(
            (h) => `  - hand check (${h.checkedAt}): ${cell(h.finding)} [source](${h.url})`,
          ),
        ])),
    "",
    "## Venues",
    "",
    "| slug | name | type | address | location | geocode Δ | parent | aliases | sources |",
    "|---|---|---|---|---|---|---|---|---|",
    ...file.venues.map((v) => {
      const d = geocodeDistance.get(v.slug);
      const delta = !args.geocode || !v.address ? "–" : d == null ? "no match" : `${d} m`;
      const sources = Object.entries(v.verification)
        .filter(([, p]) => p)
        .map(([field, p]) =>
          p!.verifiedBy === "owner"
            ? `${p!.url ? `[${field}](${p!.url})` : `${field} (no URL given)`} owner-verified ${p!.checkedAt}: ${cell(p!.confirmed)}`
            : `[${field}](${p!.url}) ${p!.checkedAt}`,
        )
        .join("<br>");
      return `| ${[
        v.slug,
        cell(v.name),
        v.venueType,
        cell(oneLine(v)) + (v.formerAddresses.length ? `<br>formerly: ${cell(v.formerAddresses.join("; "))}` : ""),
        osm(v),
        delta,
        v.parent ?? "",
        cell(v.aliases.join(", ")),
        sources,
      ].join(" | ")} |`;
    }),
    "",
    "## Sign-off",
    "",
    "After reviewing, set this in the seed file, then run `npm run venues:seed`:",
    "",
    "```json",
    `"reviewed": { "by": "<your name>", "at": "<YYYY-MM-DD>", "sha256": "${hash}" }`,
    "```",
    "",
  ];
  await writeFile(args.out, lines.join("\n"));

  for (const i of [...errors, ...warnings]) console.log(`  ${i.level.padEnd(7)} ${i.slug}: ${i.message}`);
  console.log(
    `\n${file.venues.length} venues, ${errors.length} errors, ${warnings.length} warnings. Report: ${args.out}`,
  );
  console.log(`sha256: ${hash}`);
  if (errors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
