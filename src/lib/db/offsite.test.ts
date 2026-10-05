import { describe, expect, it } from "vitest";
import { decryptWith, encryptFor, newKeyPair, type ObjectStore, pruneOld, sha256, uploadVerified } from "./offsite";

function memoryStore(corrupt = false) {
  const objects = new Map<string, { body: Uint8Array; lastModified: Date }>();
  const store: ObjectStore = {
    async put(key, body) {
      objects.set(key, { body: corrupt ? body.map((b, i) => (i === 0 ? b ^ 1 : b)) : body, lastModified: new Date() });
    },
    async get(key) {
      return objects.get(key)!.body;
    },
    async list(prefix) {
      return [...objects].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, lastModified: o.lastModified }));
    },
    async delete(key) {
      objects.delete(key);
    },
  };
  return { store, objects };
}

describe("off-site backups", () => {
  it("encrypts to the public key; only the private key decrypts", async () => {
    const { identity, recipient } = await newKeyPair();
    expect(recipient).toMatch(/^age1[0-9a-z]{58}$/);
    expect(identity).toMatch(/^AGE-SECRET-KEY-1/);
    const plain = new TextEncoder().encode("PGDMP fake dump");
    const cipher = await encryptFor(recipient, plain);
    expect(sha256(cipher)).not.toBe(sha256(plain));
    expect(new TextDecoder().decode(await decryptWith(identity, cipher))).toBe("PGDMP fake dump");
    const other = await newKeyPair();
    await expect(decryptWith(other.identity, cipher)).rejects.toThrow();
    await expect(encryptFor("not-a-key", plain)).rejects.toThrow(/age1/);
  });

  it("uploads and reads back; a mismatch fails", async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    const ok = memoryStore();
    expect(await uploadVerified(ok.store, "prod/a.age", body)).toEqual({ key: "prod/a.age", sha256: sha256(body), bytes: 4 });
    await expect(uploadVerified(memoryStore(true).store, "prod/a.age", body)).rejects.toThrow(/doesn't match/);
  });

  it("deletes copies older than 30 days, never the one just uploaded", async () => {
    const { store, objects } = memoryStore();
    const now = new Date("2026-11-10T12:00:00Z");
    const at = (iso: string) => new Date(iso);
    objects.set("prod/old.age", { body: new Uint8Array(), lastModified: at("2026-10-05T00:00:00Z") });
    objects.set("prod/recent.age", { body: new Uint8Array(), lastModified: at("2026-10-20T00:00:00Z") });
    objects.set("prod/new.age", { body: new Uint8Array(), lastModified: at("2026-09-01T00:00:00Z") }); // the one we keep
    objects.set("other/old.age", { body: new Uint8Array(), lastModified: at("2026-01-01T00:00:00Z") });
    const deleted = await pruneOld(store, now, "prod/new.age");
    expect(deleted.map((d) => d.key)).toEqual(["prod/old.age"]);
    expect([...objects.keys()].sort()).toEqual(["other/old.age", "prod/new.age", "prod/recent.age"]);
  });
});
