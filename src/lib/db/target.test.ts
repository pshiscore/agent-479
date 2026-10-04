import { describe, expect, it } from "vitest";
import { assertDatabaseTarget, DatabaseTargetError, databaseId, DEV_DATABASE_ID } from "./target";

const pooler = (id: string) => `postgresql://postgres.${id}:secret@aws-0-us-east-2.pooler.supabase.com:6543/postgres`;
const direct = (id: string) => `postgresql://postgres:secret@db.${id}.supabase.co:5432/postgres`;
const PROD = "abcdefghijklmnopqrst";

describe("databaseId", () => {
  it("reads the Supabase project from the pooler user or the direct host, else the host", () => {
    expect(databaseId(pooler(DEV_DATABASE_ID))).toBe(DEV_DATABASE_ID);
    expect(databaseId(direct(PROD))).toBe(PROD);
    expect(databaseId("postgresql://u:p@ep-cool-name.us-east-2.aws.neon.tech/db")).toBe("ep-cool-name.us-east-2.aws.neon.tech");
    expect(() => databaseId("not a url")).toThrow(DatabaseTargetError);
  });
});

describe("assertDatabaseTarget", () => {
  it("never lets production use the development database", () => {
    expect(() => assertDatabaseTarget(pooler(DEV_DATABASE_ID), { VERCEL_ENV: "production" })).toThrow(/production must not/);
    expect(() => assertDatabaseTarget(direct(DEV_DATABASE_ID), { VERCEL_ENV: "production" })).toThrow(DatabaseTargetError);
    expect(() => assertDatabaseTarget(pooler(PROD), { VERCEL_ENV: "production" })).not.toThrow();
  });
  it("never lets local, scripts, or previews use any other database", () => {
    for (const env of [{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }]) {
      expect(() => assertDatabaseTarget(pooler(PROD), env)).toThrow(/only the development database/);
      expect(() => assertDatabaseTarget(pooler(DEV_DATABASE_ID), env)).not.toThrow();
    }
  });
  it("allows a deliberate production migration, and nothing looser", () => {
    expect(() => assertDatabaseTarget(direct(PROD), { MIGRATE_PRODUCTION: "yes" })).not.toThrow();
    expect(() => assertDatabaseTarget(direct(PROD), { MIGRATE_PRODUCTION: "true" })).toThrow();
  });
});
