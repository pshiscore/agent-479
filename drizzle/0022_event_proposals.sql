CREATE TABLE "event_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"origin" text NOT NULL,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"facts" jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"match_event_id" uuid,
	"event_id" uuid,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"decision_note" text,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_proposals_status_check" CHECK (status in ('pending', 'approved', 'rejected', 'merged')),
	CONSTRAINT "event_proposals_origin_check" CHECK (origin in ('owner_form', 'registry', 'calendar', 'lead')),
	CONSTRAINT "event_proposals_reasons_check" CHECK (reasons <@ array['owner_draft', 'new_festival', 'lead_only', 'aggregator_only', 'sources_conflict', 'venue_unresolved', 'unclear_schedule', 'first_time_organizer', 'outside_coverage_area']::text[]),
	CONSTRAINT "event_proposals_event_check" CHECK ((status in ('approved', 'merged')) = (event_id is not null)),
	CONSTRAINT "event_proposals_decided_check" CHECK ((status = 'pending') = (decided_at is null) and (decided_at is null) = (decided_by is null)),
	CONSTRAINT "event_proposals_reject_note_check" CHECK (status <> 'rejected' or length(coalesce(decision_note, '')) >= 3)
);
--> statement-breakpoint
ALTER TABLE "event_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_proposals" ADD CONSTRAINT "event_proposals_match_event_id_events_id_fk" FOREIGN KEY ("match_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_proposals" ADD CONSTRAINT "event_proposals_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_proposals" ADD CONSTRAINT "event_proposals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_proposals_pending_idx" ON "event_proposals" USING btree ("created_at") WHERE "event_proposals"."status" = 'pending';