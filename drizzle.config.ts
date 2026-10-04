import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
import { assertDatabaseTarget } from "./src/lib/db/target";

// MIGRATE_PRODUCTION=yes reads .env.production.local instead: the one way to
// migrate the production database from a laptop (docs/PREDEPLOY_CHECKLIST.md).
dotenv.config({ path: process.env.MIGRATE_PRODUCTION === "yes" ? ".env.production.local" : ".env.local", quiet: true });

// Migrations need a session-capable connection: the Supabase session pooler
// or direct connection (port 5432), never the transaction pooler.
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set (see .env.example)");
assertDatabaseTarget(url);

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
