import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });

// Migrations need a session-capable connection: the Supabase session pooler
// or direct connection (port 5432), never the transaction pooler.
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set (see .env.example)");

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
