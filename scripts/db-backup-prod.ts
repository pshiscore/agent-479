/**
 * Backs up the production database before a migration (AGENTS.md rule 11):
 * pg_dump (custom format, our schemas only) into the gitignored backups/
 * folder, checked with pg_restore --list, then logged as a row in
 * docs/BACKUPS.md (commit that change).
 *
 * Usage: MIGRATE_PRODUCTION=yes npm run db:backup:prod -- --before 0022 [--note "..."]
 * Reads .env.production.local. Refuses anything but the production database.
 */
import * as dotenv from "dotenv";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import { BACKUP_LOG, sha256File } from "@/lib/db/backups";
import { PRODUCTION_DATABASE_ID, databaseId } from "@/lib/db/target";

if (process.env.MIGRATE_PRODUCTION !== "yes") throw new Error("Set MIGRATE_PRODUCTION=yes: this script only backs up production.");
dotenv.config({ path: ".env.production.local", quiet: true });

const { values: args } = parseArgs({ options: { before: { type: "string" }, note: { type: "string", default: "" } } });
if (!args.before || !/^[\w.-]{1,40}$/.test(args.before)) throw new Error("Pass --before <migration>, e.g. --before 0022");

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set in .env.production.local");
if (databaseId(url) !== PRODUCTION_DATABASE_ID) throw new Error(`Not the production database (${databaseId(url)}); refusing.`);

const bin = process.env.PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "") + "Z"; // 20261005T1200Z
const file = `backups/prod-${stamp}-before-${args.before}.dump`;
mkdirSync("backups", { recursive: true });

const dump = spawnSync(`${bin}/pg_dump`, ["--dbname", url, "--schema=public", "--schema=drizzle", "--format=custom", "--no-owner", "--file", file], {
  stdio: ["ignore", "inherit", "inherit"],
});
if (dump.status !== 0 || !existsSync(file)) throw new Error(`pg_dump failed (exit ${dump.status})`);
chmodSync(file, 0o600);

// A dump that pg_restore can't list isn't a backup.
const list = spawnSync(`${bin}/pg_restore`, ["--list", file], { encoding: "utf8" });
const entries = list.status === 0 ? list.stdout.split("\n").filter((l) => /^\d+;/.test(l)).length : 0;
if (entries === 0) throw new Error(`pg_restore --list can't read ${file}`);

const bytes = statSync(file).size;
const sha = sha256File(file);
const takenAt = `${new Date().toISOString().slice(0, 16)}Z`;
appendFileSync(BACKUP_LOG, `| ${takenAt} | ${file} | ${bytes} | ${sha} | ${args.before} | ${entries} entries${args.note ? `; ${args.note}` : ""} |\n`);
console.log(`Backed up production to ${file} (${bytes} bytes, ${entries} entries); logged in ${BACKUP_LOG}. Commit the log.`);
