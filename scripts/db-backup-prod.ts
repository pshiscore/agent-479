/**
 * Backs up the production database before a migration (AGENTS.md rule 11):
 * 1. pg_dump (custom format, our schemas only) into the gitignored backups/
 *    folder, checked with pg_restore --list;
 * 2. encrypts it with age to BACKUP_AGE_RECIPIENT (the owner's public key;
 *    the private key stays in the owner's password manager);
 * 3. uploads it to the private R2 bucket and reads it back to verify;
 * 4. deletes off-site copies older than 30 days (logged in
 *    docs/BACKUPS-PRUNED.md);
 * 5. only then logs the backup as complete in docs/BACKUPS.md (commit it).
 *
 * Usage: MIGRATE_PRODUCTION=yes npm run db:backup:prod -- --before 0024 [--note "..."]
 * Reads .env.production.local. Refuses anything but the production database.
 */
import * as dotenv from "dotenv";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { BACKUP_LOG, PRUNE_LOG, sha256File } from "@/lib/db/backups";
import { encryptFor, OFFSITE_PREFIX, OFFSITE_RETENTION_DAYS, pruneOld, uploadVerified } from "@/lib/db/offsite";
import { r2FromEnv } from "@/lib/db/r2-store";
import { PRODUCTION_DATABASE_ID, databaseId } from "@/lib/db/target";

if (process.env.MIGRATE_PRODUCTION !== "yes") throw new Error("Set MIGRATE_PRODUCTION=yes: this script only backs up production.");
dotenv.config({ path: ".env.production.local", quiet: true });

const { values: args } = parseArgs({ options: { before: { type: "string" }, note: { type: "string", default: "" } } });
if (!args.before || !/^[\w.-]{1,40}$/.test(args.before)) throw new Error("Pass --before <migration>, e.g. --before 0024");

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set in .env.production.local");
if (databaseId(url) !== PRODUCTION_DATABASE_ID) throw new Error(`Not the production database (${databaseId(url)}); refusing.`);
// Check the off-site setup before dumping, so a missing setting fails fast.
const recipient = process.env.BACKUP_AGE_RECIPIENT;
if (!recipient) throw new Error("Off-site backup isn't configured: set BACKUP_AGE_RECIPIENT (age1…) in .env.production.local");
const { store, bucket } = r2FromEnv();

async function main() {
  const bin = process.env.PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "") + "Z"; // 20261005T1200Z
  const file = `backups/prod-${stamp}-before-${args.before}.dump`;
  mkdirSync("backups", { recursive: true });

  const dump = spawnSync(`${bin}/pg_dump`, ["--dbname", url!, "--schema=public", "--schema=drizzle", "--format=custom", "--no-owner", "--file", file], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (dump.status !== 0 || !existsSync(file)) throw new Error(`pg_dump failed (exit ${dump.status})`);
  chmodSync(file, 0o600);

  // A dump that pg_restore can't list isn't a backup.
  const list = spawnSync(`${bin}/pg_restore`, ["--list", file], { encoding: "utf8" });
  const entries = list.status === 0 ? list.stdout.split("\n").filter((l) => /^\d+;/.test(l)).length : 0;
  if (entries === 0) throw new Error(`pg_restore --list can't read ${file}`);

  // Encrypt, upload, read back.
  const cipher = await encryptFor(recipient!, readFileSync(file));
  const key = `${OFFSITE_PREFIX}${basename(file)}.age`;
  const up = await uploadVerified(store, key, cipher);
  console.log(`Off-site: r2:${bucket}/${key} (${up.bytes} bytes encrypted), read back and matched.`);

  // Retention: delete copies older than 30 days, each logged.
  const now = new Date();
  const pruned = await pruneOld(store, now, key);
  if (pruned.length) {
    if (!existsSync(PRUNE_LOG)) appendFileSync(PRUNE_LOG, "# Off-site backups deleted after 30 days\n\n| Deleted (UTC) | Object | Uploaded (UTC) |\n|---|---|---|\n");
    for (const o of pruned) appendFileSync(PRUNE_LOG, `| ${now.toISOString().slice(0, 16)}Z | r2:${bucket}/${o.key} | ${o.lastModified.toISOString().slice(0, 16)}Z |\n`);
    console.log(`Deleted ${pruned.length} off-site cop${pruned.length === 1 ? "y" : "ies"} older than ${OFFSITE_RETENTION_DAYS} days; logged in ${PRUNE_LOG}.`);
  }

  // Complete: log it.
  const bytes = statSync(file).size;
  const takenAt = `${now.toISOString().slice(0, 16)}Z`;
  const note = [`${entries} entries`, `off-site: r2:${bucket}/${key} sha256 ${up.sha256}`, args.note].filter(Boolean).join("; ");
  appendFileSync(BACKUP_LOG, `| ${takenAt} | ${file} | ${bytes} | ${sha256File(file)} | ${args.before} | ${note} |\n`);
  console.log(`Backed up production to ${file} (${bytes} bytes, ${entries} entries); logged in ${BACKUP_LOG}. Commit the log.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
