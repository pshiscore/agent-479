import { createHash } from "node:crypto";
import { Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from "age-encryption";

/**
 * Off-site copies of production backups (AGENTS.md rule 11). Each dump is
 * encrypted with age to the owner's public key (the private key lives in the
 * owner's password manager, never in the repo or on this machine's env),
 * uploaded to a private Cloudflare R2 bucket, and read back to check it
 * matches before the backup is logged as complete. Copies older than
 * OFFSITE_RETENTION_DAYS are deleted, each deletion logged.
 *
 * The store is an interface so tests use an in-memory one; the script wires
 * it to R2's S3 API.
 */

export const OFFSITE_PREFIX = "prod/";
export const OFFSITE_RETENTION_DAYS = 30;

export interface ObjectStore {
  put(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  list(prefix: string): Promise<{ key: string; lastModified: Date }[]>;
  delete(key: string): Promise<void>;
}

export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export async function encryptFor(recipient: string, plain: Uint8Array): Promise<Uint8Array> {
  if (!/^age1[0-9a-z]{58}$/.test(recipient)) throw new Error("BACKUP_AGE_RECIPIENT must be an age X25519 public key (age1…)");
  const e = new Encrypter();
  e.addRecipient(recipient);
  return e.encrypt(plain);
}

/** For restores and tests: needs the private key, which the backup script never has. */
export async function decryptWith(identity: string, cipher: Uint8Array): Promise<Uint8Array> {
  const d = new Decrypter();
  d.addIdentity(identity);
  return d.decrypt(cipher, "uint8array");
}

/** A new key pair: the identity (private) goes to the owner's password manager; the recipient (public) to the env. */
export async function newKeyPair() {
  const identity = await generateX25519Identity();
  return { identity, recipient: await identityToRecipient(identity) };
}

/** Uploads and reads back: resolves only when the stored bytes hash to the same SHA-256. */
export async function uploadVerified(store: ObjectStore, key: string, body: Uint8Array): Promise<{ key: string; sha256: string; bytes: number }> {
  const want = sha256(body);
  await store.put(key, body);
  const got = sha256(await store.get(key));
  if (got !== want) throw new Error(`off-site copy ${key} doesn't match (uploaded ${want.slice(0, 12)}…, read back ${got.slice(0, 12)}…)`);
  return { key, sha256: want, bytes: body.length };
}

/** Deletes copies older than the retention window, never the one just uploaded. Returns what it deleted. */
export async function pruneOld(store: ObjectStore, now: Date, keep: string, days = OFFSITE_RETENTION_DAYS): Promise<{ key: string; lastModified: Date }[]> {
  const cutoff = now.getTime() - days * 86_400_000;
  const old = (await store.list(OFFSITE_PREFIX)).filter((o) => o.key !== keep && o.lastModified.getTime() < cutoff);
  for (const o of old) await store.delete(o.key);
  return old;
}
