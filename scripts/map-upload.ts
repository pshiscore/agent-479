/**
 * Uploads the venues map files (map-build/: the tile extract, fonts, sprites,
 * their licenses, and NOTICE.txt) to our public R2 map bucket (R2_MAP_BUCKET,
 * with the same R2 account and keys as the backups). The tile file's name
 * carries its build date, so it's cached for good; fonts and sprites for a week.
 *
 * Usage: MIGRATE_PRODUCTION=yes npm run map:upload
 */
import * as dotenv from "dotenv";
const production = process.env.MIGRATE_PRODUCTION === "yes";
dotenv.config({ path: production ? ".env.production.local" : ".env.local", quiet: true, override: production });

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { MAP_FILE } from "@/config/map";

const TYPES: Record<string, string> = { pmtiles: "application/octet-stream", pbf: "application/x-protobuf", png: "image/png", json: "application/json", txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8" };

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

async function main() {
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_MAP_BUCKET"]) if (!process.env[k]) throw new Error(`${k} is not set`);
  const s3 = new S3Client({ region: "auto", endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } });
  const Bucket = process.env.R2_MAP_BUCKET!;
  const list = [join("map-build", MAP_FILE), join("map-build", "NOTICE.txt"), ...files("map-build/assets")];
  for (const path of list) {
    const Key = relative("map-build/assets", path).startsWith("..") ? relative("map-build", path) : relative("map-build/assets", path);
    const ext = path.split(".").pop()!;
    const body = readFileSync(path);
    const head = await s3.send(new HeadObjectCommand({ Bucket, Key })).catch(() => null);
    if (head?.ContentLength === body.length) continue;
    await s3.send(
      new PutObjectCommand({ Bucket, Key, Body: body, ContentType: TYPES[ext] ?? "application/octet-stream", CacheControl: Key === MAP_FILE ? "public, max-age=31536000, immutable" : "public, max-age=604800" }),
    );
    console.log("uploaded", Key, body.length);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
