CREATE TABLE "event_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"email" text,
	"place_text" text NOT NULL,
	"organizer_name" text,
	"note" text,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_submissions_purge_check" CHECK ((purged_at is null) = (email is not null) and (purged_at is null or note is null))
);
--> statement-breakpoint
ALTER TABLE "event_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_proposals" DROP CONSTRAINT "event_proposals_origin_check";--> statement-breakpoint
ALTER TABLE "event_proposals" DROP CONSTRAINT "event_proposals_reasons_check";--> statement-breakpoint
ALTER TABLE "event_submissions" ADD CONSTRAINT "event_submissions_proposal_id_event_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."event_proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_submissions_proposal_uniq" ON "event_submissions" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "event_submissions_email_idx" ON "event_submissions" USING btree ("email","created_at");--> statement-breakpoint
ALTER TABLE "event_proposals" ADD CONSTRAINT "event_proposals_origin_check" CHECK (origin in ('owner_form', 'registry', 'calendar', 'lead', 'shadow', 'submission'));--> statement-breakpoint
ALTER TABLE "event_proposals" ADD CONSTRAINT "event_proposals_reasons_check" CHECK (reasons <@ array['owner_draft', 'new_festival', 'lead_only', 'aggregator_only', 'sources_conflict', 'venue_unresolved', 'unclear_schedule', 'first_time_organizer', 'outside_coverage_area', 'shadow_source', 'shadow_update', 'submitted']::text[]);