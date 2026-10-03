/**
 * Checks the live database against the rules the app depends on.
 * Usage: npm run db:verify   (reads .env.local)
 * Exits non-zero if any check fails.
 */
import * as dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: ".env.local", quiet: true });

const EXPECTED_TABLES = [
  "runs",
  "llm_models",
  "llm_calls",
  "agent_actions",
  "venues",
  "venue_external_ids",
  "sources",
  "link_policies",
  "categories",
  "tags",
];
const EXPECTED_EXTENSIONS = ["pg_trgm", "unaccent"];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  const failures: string[] = [];
  const ok = (msg: string) => console.log(`  ok    ${msg}`);
  const fail = (msg: string) => {
    failures.push(msg);
    console.log(`  FAIL  ${msg}`);
  };

  try {
    const [{ tz }] = await sql<{ tz: string }[]>`select current_setting('TimeZone') as tz`;
    if (tz === "UTC" || tz === "Etc/UTC") ok(`session time zone is ${tz}`);
    else fail(`session time zone is ${tz}, expected UTC`);

    const exts = await sql<{ extname: string; schema: string }[]>`
      select e.extname, n.nspname as schema
      from pg_extension e join pg_namespace n on n.oid = e.extnamespace`;
    for (const name of EXPECTED_EXTENSIONS) {
      const ext = exts.find((e) => e.extname === name);
      if (ext) ok(`extension ${name} installed (schema ${ext.schema})`);
      else fail(`extension ${name} missing`);
    }

    const tables = await sql<{ relname: string; rls: boolean }[]>`
      select c.relname, c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname`;
    for (const name of EXPECTED_TABLES) {
      if (tables.some((t) => t.relname === name)) ok(`table ${name} exists`);
      else fail(`table ${name} missing`);
    }
    // Every public table must have RLS on, or Supabase's Data API exposes it.
    for (const t of tables) {
      if (t.rls) ok(`RLS enabled on ${t.relname}`);
      else fail(`RLS DISABLED on public.${t.relname}`);
    }

    // No policies = deny-all for anon/authenticated. Any policy needs review.
    const policies = await sql<{ tablename: string; policyname: string }[]>`
      select tablename, policyname from pg_policies where schemaname = 'public'`;
    if (policies.length === 0) ok("no RLS policies on public tables (deny-all for API roles)");
    else for (const p of policies) fail(`unexpected policy ${p.policyname} on ${p.tablename}`);
  } finally {
    await sql.end({ timeout: 5 });
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
