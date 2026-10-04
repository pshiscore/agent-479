/**
 * Keeps development and production databases apart, in code (owner,
 * 2026-10-04: one Supabase project, used only by production; development runs
 * on Postgres on the laptop):
 * - Production (VERCEL_ENV=production) may use only the production project.
 * - Everything else (local, scripts, tests, previews) may use only a local
 *   database, so nothing outside production ever writes to production.
 * Migrating production is the one deliberate exception, through
 * drizzle.config.ts with MIGRATE_PRODUCTION=yes (docs/PREDEPLOY_CHECKLIST.md).
 *
 * A database is identified by its Supabase project ID (the "postgres.<id>"
 * pooler user or the "db.<id>.supabase.co" host), or by its host for any other
 * provider. Project IDs appear in hostnames; they aren't credentials.
 */

export const PRODUCTION_DATABASE_ID = "sjpzfskwhkvcqqhbxrbd";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", ""]);

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

export function isLocalDatabase(url: string): boolean {
  return LOCAL_HOSTS.has(databaseId(url));
}

export function assertDatabaseTarget(
  url: string,
  env: { [key: string]: string | undefined; VERCEL_ENV?: string; MIGRATE_PRODUCTION?: string } = process.env,
): void {
  const id = databaseId(url);
  if (env.VERCEL_ENV === "production") {
    if (id !== PRODUCTION_DATABASE_ID) throw new DatabaseTargetError("production may use only the production database");
    return;
  }
  if (id === PRODUCTION_DATABASE_ID) {
    if (env.MIGRATE_PRODUCTION === "yes") return;
    throw new DatabaseTargetError("only production uses the production database; local work uses the local one (production is migrated deliberately: MIGRATE_PRODUCTION=yes)");
  }
  if (!isLocalDatabase(url)) {
    throw new DatabaseTargetError("outside production only a local database may be used (postgresql://localhost/agent479_dev)");
  }
}
