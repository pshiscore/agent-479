import { timestamp, uuid } from "drizzle-orm/pg-core";

export const id = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** SQL list literal for CHECK constraints: ('a', 'b', 'c'). */
export function sqlList(values: readonly string[]): string {
  return `(${values.map((v) => `'${v.replaceAll("'", "''")}'`).join(", ")})`;
}
