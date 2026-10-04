/**
 * Keeps development and production databases apart, in code:
 * - Production (VERCEL_ENV=production) refuses the development database.
 * - Everything else (local, scripts, tests, preview deployments) may use only
 *   the development database, so nothing local ever writes to production.
 * Migrating production is the one deliberate exception, through
 * drizzle.config.ts with MIGRATE_PRODUCTION=yes (docs/PREDEPLOY_CHECKLIST.md).
 *
 * A database is identified by its Supabase project ID (the "postgres.<id>"
 * pooler user or the "db.<id>.supabase.co" host), or by its host for any other
 * provider. Project IDs appear in hostnames; they aren't credentials.
 */

export const DEV_DATABASE_ID = "sjpzfskwhkvcqqhbxrbd";

export class DatabaseTargetError extends Error {}

export function databaseId(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new DatabaseTargetError("database URL is not a valid URL");
  }
  const pooler = /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(u.username));
  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(u.hostname);
  return pooler?.[1] ?? direct?.[1] ?? u.hostname;
}

export function assertDatabaseTarget(url: string, env: { [key: string]: string | undefined; VERCEL_ENV?: string; MIGRATE_PRODUCTION?: string } = process.env): void {
  const isDev = databaseId(url) === DEV_DATABASE_ID;
  if (env.VERCEL_ENV === "production") {
    if (isDev) throw new DatabaseTargetError("production must not use the development database");
    return;
  }
  if (!isDev && env.MIGRATE_PRODUCTION !== "yes") {
    throw new DatabaseTargetError("outside production only the development database may be used (production is migrated deliberately: MIGRATE_PRODUCTION=yes)");
  }
}
