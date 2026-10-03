import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, sqlList } from "./columns";

export const RUN_JOBS = [
  "fetch",
  "process",
  "maintenance",
  "digest_draft",
  "digest_recheck",
  "publish",
  "seed",
  "manual",
] as const;
export const RUN_STATUSES = ["running", "ok", "partial", "failed"] as const;

/** One row per job invocation. Its id is the run_id threaded through all logs. */
export const runs = pgTable(
  "runs",
  {
    id: id(),
    job: text("job", { enum: RUN_JOBS }).notNull(),
    // FK to sources is added when the sources table exists (build step 7).
    sourceId: uuid("source_id"),
    status: text("status", { enum: RUN_STATUSES }).notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
  },
  (t) => [
    index("runs_job_started_idx").on(t.job, t.startedAt.desc()),
    check("runs_job_check", sql.raw(`job in ${sqlList(RUN_JOBS)}`)),
    check("runs_status_check", sql.raw(`status in ${sqlList(RUN_STATUSES)}`)),
  ],
).enableRLS();
