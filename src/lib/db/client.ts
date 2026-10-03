import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the pool or an open transaction. */
export type DbExecutor = Db | DbTx;

// Reuse one client per serverless instance (and across dev hot reloads).
const globalForDb = globalThis as unknown as { agent479Db?: Db };

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  const client = postgres(url, {
    // Supabase transaction pooler (Supavisor) doesn't support prepared statements.
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connection: { application_name: "agent-479" },
  });
  return drizzle(client, { schema });
}

/** Lazily created so importing this module never needs env vars (e.g. at build). */
export function getDb(): Db {
  globalForDb.agent479Db ??= createDb();
  return globalForDb.agent479Db;
}
