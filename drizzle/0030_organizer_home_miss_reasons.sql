ALTER TABLE "organizers" DROP CONSTRAINT "organizers_county_check";--> statement-breakpoint
ALTER TABLE "benchmark_items" DROP CONSTRAINT "benchmark_items_miss_reason_check";--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "organizers" ADD COLUMN "holds_events_in_area" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "benchmark_items" ADD COLUMN "suggested_reason" text;--> statement-breakpoint
ALTER TABLE "benchmark_items" ADD COLUMN "match_overridden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizers" ADD CONSTRAINT "organizers_state_check" CHECK (state is null or state ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "organizers" ADD CONSTRAINT "organizers_holds_events_check" CHECK (holds_events_in_area in ('yes', 'no', 'unknown'));--> statement-breakpoint
ALTER TABLE "benchmark_items" ADD CONSTRAINT "benchmark_items_suggested_reason_check" CHECK (suggested_reason is null or suggested_reason in ('no_source', 'social_only', 'not_in_feed', 'filtered', 'rejected', 'wrong_details', 'outside_area', 'permission_pending', 'source_not_enabled', 'other'));--> statement-breakpoint
ALTER TABLE "benchmark_items" ADD CONSTRAINT "benchmark_items_miss_reason_check" CHECK (miss_reason is null or (result = 'missed' and miss_reason in ('no_source', 'social_only', 'not_in_feed', 'filtered', 'rejected', 'wrong_details', 'outside_area', 'permission_pending', 'source_not_enabled', 'other')));