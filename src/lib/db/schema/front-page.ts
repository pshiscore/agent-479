import { index, jsonb, numeric, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { id } from "./columns";
import { events } from "./events";
import { runs } from "./runs";

/**
 * The homepage feature slot's history (docs/product/front-page.md, B1): one
 * row each time the chosen event changes, with the rules that chose it. The
 * newest row is the current feature. Written by the process job, logged.
 */
export const homepageFeatures = pgTable(
  "homepage_features",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    // Which rules the event met, e.g. { newlyAnnounced: true, largeVenue: true }.
    rules: jsonb("rules").$type<Record<string, boolean>>().notNull(),
    score: numeric("score", { precision: 6, scale: 2, mode: "number" }).notNull(),
    chosenAt: timestamp("chosen_at", { withTimezone: true }).notNull().defaultNow(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  },
  (t) => [index("homepage_features_chosen_idx").on(t.chosenAt.desc())],
).enableRLS();
