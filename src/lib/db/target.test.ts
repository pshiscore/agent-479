import { describe, expect, it } from "vitest";
import { assertDatabaseTarget, DatabaseTargetError, databaseId, isLocalDatabase, PRODUCTION_DATABASE_ID } from "./target";

const pooler = (id: string) => `postgresql://postgres.${id}:secret@aws-0-us-east-2.pooler.supabase.com:6543/postgres`;
const direct = (id: string) => `postgresql://postgres:secret@db.${id}.supabase.co:5432/postgres`;
const LOCAL = "postgresql://vladkrasikov@localhost:5432/agent479_dev";
const OTHER = "abcdefghijklmnopqrst";

describe("databaseId", () => {
  it("reads the Supabase project from the pooler user or the direct host, else the host", () => {
    expect(databaseId(pooler(PRODUCTION_DATABASE_ID))).toBe(PRODUCTION_DATABASE_ID);
    expect(databaseId(direct(OTHER))).toBe(OTHER);
    expect(databaseId("postgresql://u:p@ep-cool-name.us-east-2.aws.neon.tech/db")).toBe("ep-cool-name.us-east-2.aws.neon.tech");
    expect(isLocalDatabase(LOCAL)).toBe(true);
    expect(isLocalDatabase("postgresql://127.0.0.1/agent479_dev")).toBe(true);
    expect(isLocalDatabase(pooler(OTHER))).toBe(false);
    expect(() => databaseId("not a url")).toThrow(DatabaseTargetError);
  });
});

describe("assertDatabaseTarget", () => {
  it("lets production use only the production project", () => {
    expect(() => assertDatabaseTarget(pooler(PRODUCTION_DATABASE_ID), { VERCEL_ENV: "production" })).not.toThrow();
    expect(() => assertDatabaseTarget(LOCAL, { VERCEL_ENV: "production" })).toThrow(/only the production database/);
    expect(() => assertDatabaseTarget(pooler(OTHER), { VERCEL_ENV: "production" })).toThrow(DatabaseTargetError);
  });
  it("keeps local work, scripts, tests, and previews off production and on a local database", () => {
    for (const env of [{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }]) {
      expect(() => assertDatabaseTarget(pooler(PRODUCTION_DATABASE_ID), env)).toThrow(/only production uses/);
      expect(() => assertDatabaseTarget(direct(PRODUCTION_DATABASE_ID), env)).toThrow(DatabaseTargetError);
      expect(() => assertDatabaseTarget(pooler(OTHER), env)).toThrow(/only a local database/);
      expect(() => assertDatabaseTarget(LOCAL, env)).not.toThrow();
    }
  });
  it("allows a deliberate production migration, and nothing looser", () => {
    expect(() => assertDatabaseTarget(pooler(PRODUCTION_DATABASE_ID), { MIGRATE_PRODUCTION: "yes" })).not.toThrow();
    expect(() => assertDatabaseTarget(pooler(PRODUCTION_DATABASE_ID), { MIGRATE_PRODUCTION: "true" })).toThrow();
  });
});
