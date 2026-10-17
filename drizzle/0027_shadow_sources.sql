ALTER TABLE "event_proposals" DROP CONSTRAINT "event_proposals_origin_check";--> statement-breakpoint
ALTER TABLE "event_proposals" DROP CONSTRAINT "event_proposals_reasons_check";--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "publish_state" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "publish_state_since" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "event_proposals" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "event_proposals" ADD COLUMN "raw_record_id" uuid;--> statement-breakpoint
ALTER TABLE "event_proposals" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "event_proposals" ADD COLUMN "draft" jsonb;--> statement-breakpoint
ALTER TABLE "event_proposals" ADD COLUMN "flags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "event_proposals" ADD COLUMN "reject_kind" text;--> statement-breakpoint
ALTER TABLE "event_proposals" ADD CONSTRAINT "event_proposals_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_proposals" ADD CONSTRAINT "event_proposals_raw_record_id_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."raw_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_proposals_source_record_uniq" ON "event_proposals" USING btree ("source_id","external_id") WHERE "event_proposals"."source_id" is not null;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_publish_state_check" CHECK (publish_state in ('proposed', 'shadow', 'live', 'paused'));--> statement-breakpoint
ALTER TABLE "event_proposals" ADD CONSTRAINT "event_proposals_shadow_check" CHECK ((origin = 'shadow') = (source_id is not null and external_id is not null and draft is not null));--> statement-breakpoint
ALTER TABLE "event_proposals" ADD CONSTRAINT "event_proposals_flags_check" CHECK (flags <@ array['conflict', 'outside_coverage', 'community_fallback', 'description_held']::text[]);--> statement-breakpoint
ALTER TABLE "event_proposals" ADD CONSTRAINT "event_proposals_reject_kind_check" CHECK ((reject_kind is null) or (status = 'rejected' and reject_kind in ('wrong_date', 'wrong_venue', 'not_public', 'duplicate', 'filtered', 'outside_area', 'other')));--> statement-breakpoint
ALTER TABLE "event_proposals" ADD CONSTRAINT "event_proposals_origin_check" CHECK (origin in ('owner_form', 'registry', 'calendar', 'lead', 'shadow'));--> statement-breakpoint
ALTER TABLE "event_proposals" ADD CONSTRAINT "event_proposals_reasons_check" CHECK (reasons <@ array['owner_draft', 'new_festival', 'lead_only', 'aggregator_only', 'sources_conflict', 'venue_unresolved', 'unclear_schedule', 'first_time_organizer', 'outside_coverage_area', 'shadow_source']::text[]);