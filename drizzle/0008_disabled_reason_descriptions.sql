ALTER TABLE "raw_records" DROP CONSTRAINT "raw_records_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "raw_records" ALTER COLUMN "run_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "disabled_reason" text DEFAULT 'untested';--> statement-breakpoint
ALTER TABLE "raw_records" ADD COLUMN "description_text" text;--> statement-breakpoint
ALTER TABLE "raw_records" ADD COLUMN "description_purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "raw_records" ADD CONSTRAINT "raw_records_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "raw_records_description_purge_idx" ON "raw_records" USING btree ("description_purge_after") WHERE "raw_records"."description_text" is not null;--> statement-breakpoint
-- Data: the new column defaulted every row to 'untested'. Enabled sources have
-- no reason, and the three awaiting written permission say so.
UPDATE "sources" SET "disabled_reason" = NULL WHERE "enabled";--> statement-breakpoint
UPDATE "sources" SET "disabled_reason" = 'awaiting_permission'
  WHERE "slug" IN ('walton-arts-center', 'crystal-bridges', 'the-momentary');--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_disabled_reason_check" CHECK ((enabled and disabled_reason is null) or (not enabled and disabled_reason in ('untested', 'awaiting_permission', 'blocked', 'manual')));