/**
 * Restore helper: downloads an off-site backup from R2 and decrypts it with
 * your private key, into backups/ (gitignored). The key is read from a file
 * you point to (e.g. pasted from your password manager into a temp file);
 * delete that file afterwards.
 *
 * Usage: MIGRATE_PRODUCTION=yes npm run db:backup:fetch -- --key prod/<file>.dump.age --identity-file /path/to/key.txt
 * Then restore into a scratch database first: pg_restore --no-owner --dbname <url> backups/<file>.dump
 */
import * as dotenv from "dotenv";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { decryptWith } from "@/lib/db/offsite";
import { r2FromEnv } from "@/lib/db/r2-store";

dotenv.config({ path: ".env.production.local", quiet: true });
const { values: args } = parseArgs({ options: { key: { type: "string" }, "identity-file": { type: "string" } } });

async function main() {
  if (!args.key || !args["identity-file"]) throw new Error("Pass --key prod/<file>.age and --identity-file <path>");
  const identity = readFileSync(args["identity-file"], "utf8").split("\n").find((l) => l.startsWith("AGE-SECRET-KEY-"));
  if (!identity) throw new Error("No AGE-SECRET-KEY- line in the identity file");
  const { store } = r2FromEnv();
  const plain = await decryptWith(identity.trim(), await store.get(args.key));
  const out = `backups/restored-${basename(args.key).replace(/\.age$/, "")}`;
  writeFileSync(out, plain);
  chmodSync(out, 0o600);
  console.log(`Decrypted to ${out} (${plain.length} bytes). Restore into a scratch database first.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
