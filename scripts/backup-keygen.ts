/**
 * Makes the age key pair for off-site backups, once. The private key is
 * written to a file in your home folder (never the repo) for you to move into
 * your password manager; then delete the file. Only the public key goes in
 * .env.production.local as BACKUP_AGE_RECIPIENT.
 *
 * Usage: npm run backup:keygen
 */
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { newKeyPair } from "@/lib/db/offsite";

async function main() {
  const path = join(homedir(), "agent479-backup-key.txt");
  if (existsSync(path)) throw new Error(`${path} already exists; move it to your password manager and delete it first`);
  const { identity, recipient } = await newKeyPair();
  writeFileSync(path, `# 479 Guide backup key. Store in your password manager, then delete this file.\n# public key: ${recipient}\n${identity}\n`, { mode: 0o600 });
  console.log(`Private key written to ${path} (only you can read it).`);
  console.log("1. Save its contents in your password manager, then delete the file.");
  console.log(`2. Add to .env.production.local:\n   BACKUP_AGE_RECIPIENT=${recipient}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
