CREATE TABLE "raw_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"run_id" uuid,
	"external_id" text NOT NULL,
	"source_url" text,
	"content_hash" text NOT NULL,
	"payload" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"location_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"event_id" uuid,
	CONSTRAINT "raw_records_status_check" CHECK (status in ('pending', 'mapped', 'extracted', 'needs_venue', 'skipped', 'failed')),
	CONSTRAINT "raw_records_skip_check" CHECK (status <> 'skipped' or skip_reason is not null),
	CONSTRAINT "raw_records_attempts_check" CHECK (attempts >= 0)
);
--> statement-breakpoint
ALTER TABLE "raw_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "raw_records" ADD CONSTRAINT "raw_records_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_records" ADD CONSTRAINT "raw_records_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "raw_records_source_external_uniq" ON "raw_records" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "raw_records_status_fetched_idx" ON "raw_records" USING btree ("status","fetched_at");--> statement-breakpoint
CREATE INDEX "raw_records_needs_venue_idx" ON "raw_records" USING btree ("location_key") WHERE "raw_records"."status" = 'needs_venue';