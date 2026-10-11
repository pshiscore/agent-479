import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
import { assertRecentBackup } from "./src/lib/db/backups";
import { assertDatabaseTarget, databaseId, PRODUCTION_DATABASE_ID } from "./src/lib/db/target";

// MIGRATE_PRODUCTION=yes reads .env.production.local instead: the one way to
// migrate the production database from a laptop (docs/PREDEPLOY_CHECKLIST.md).
// Production values win over anything already set in the shell (2026-10-11: an exported local
// DATABASE_URL_UNPOOLED made a "production" migrate run against the local database).
const production = process.env.MIGRATE_PRODUCTION === "yes";
dotenv.config({ path: production ? ".env.production.local" : ".env.local", quiet: true, override: production });

// Migrations need a session-capable connection: the Supabase session pooler
// or direct connection (port 5432), never the transaction pooler.
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set (see .env.example)");
assertDatabaseTarget(url);
if (production && databaseId(url) !== PRODUCTION_DATABASE_ID) {
  throw new Error(`MIGRATE_PRODUCTION=yes but the database is ${databaseId(url)}, not production; refusing.`);
}
// A production migration needs a logged backup from the last 2 hours (AGENTS.md rule 11).
if (process.env.MIGRATE_PRODUCTION === "yes" && process.argv.includes("migrate")) {
  const b = assertRecentBackup();
  console.log(`Backup on file: ${b.file} (${b.takenAt.toISOString()}, before ${b.before})`);
}

export default defineConfig({
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  // Only manage our own schema. Supabase owns auth, storage, extensions, etc.
  schemaFilter: ["public"],
  verbose: true,
  strict: true,
});
