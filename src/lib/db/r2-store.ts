import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ObjectStore } from "./offsite";

/**
 * A private Cloudflare R2 bucket through its S3-compatible API, for the
 * backup scripts only (never imported by the app). Credentials come from
 * .env.production.local: an R2 API token scoped to this one bucket.
 */

export const R2_ENV = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;

export function r2FromEnv(env: NodeJS.ProcessEnv = process.env): { store: ObjectStore; bucket: string } {
  const missing = R2_ENV.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Off-site backup isn't configured: set ${missing.join(", ")} in .env.production.local`);
  const bucket = env.R2_BUCKET!;
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
  });
  const store: ObjectStore = {
    async put(key, body) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/octet-stream" }));
    },
    async get(key) {
      const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return new Uint8Array(await r.Body!.transformToByteArray());
    },
    async list(prefix) {
      const out: { key: string; lastModified: Date }[] = [];
      let token: string | undefined;
      do {
        const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        for (const o of r.Contents ?? []) if (o.Key && o.LastModified) out.push({ key: o.Key, lastModified: o.LastModified });
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
  return { store, bucket };
}
