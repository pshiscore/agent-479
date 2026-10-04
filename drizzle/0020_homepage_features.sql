CREATE TABLE "homepage_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"rules" jsonb NOT NULL,
	"score" numeric(6, 2) NOT NULL,
	"chosen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_id" uuid
);
--> statement-breakpoint
ALTER TABLE "homepage_features" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "homepage_features" ADD CONSTRAINT "homepage_features_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homepage_features" ADD CONSTRAINT "homepage_features_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "homepage_features_chosen_idx" ON "homepage_features" USING btree ("chosen_at" DESC NULLS LAST);