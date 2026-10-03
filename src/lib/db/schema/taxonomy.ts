import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./columns";

const SLUG_CHECK = `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`;

/**
 * Every event has exactly one category. The classifier's allowed values come
 * from the active rows at run time, so adding one needs no deploy. Categories
 * are retired with active = false, never deleted, because events reference them.
 */
export const categories = pgTable(
  "categories",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    // Display order on the site and in filters, ascending.
    sort: integer("sort").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("categories_slug_uniq").on(t.slug),
    uniqueIndex("categories_name_uniq").on(sql`lower(${t.name})`),
    check("categories_slug_check", sql.raw(SLUG_CHECK)),
    check("categories_sort_check", sql.raw(`sort >= 0`)),
  ],
).enableRLS();

/** Any number per event. Same run-time enum and never-delete rules as categories. */
export const tags = pgTable(
  "tags",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("tags_slug_uniq").on(t.slug),
    uniqueIndex("tags_name_uniq").on(sql`lower(${t.name})`),
    check("tags_slug_check", sql.raw(SLUG_CHECK)),
  ],
).enableRLS();
