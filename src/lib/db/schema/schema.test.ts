import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./index";
import { sqlList } from "./columns";

const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable =>
  is(v, PgTable),
);

describe("schema", () => {
  it("exports the tables built so far", () => {
    expect(tables.map((t) => getTableConfig(t).name).sort()).toEqual(
      [
        "agent_actions",
        "categories",
        "link_policies",
        "llm_calls",
        "llm_models",
        "raw_records",
        "runs",
        "sources",
        "tags",
        "venue_external_ids",
        "venues",
      ].sort(),
    );
  });

  // Supabase exposes every public table through its Data API unless RLS is on.
  it.each(tables.map((t) => [getTableConfig(t).name, t] as const))(
    "%s has RLS enabled",
    (_name, table) => {
      expect(getTableConfig(table).enableRLS).toBe(true);
    },
  );
});

describe("sqlList", () => {
  it("quotes and escapes values", () => {
    expect(sqlList(["a", "it's"])).toBe("('a', 'it''s')");
  });
});
