CREATE TABLE "feed_discoveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizer_id" uuid NOT NULL,
	"url" text NOT NULL,
	"kind" text NOT NULL,
	"platform" text,
	"robots_result" text NOT NULL,
	"robots_checked_at" timestamp with time zone NOT NULL,
	"terms_url" text,
	"terms_flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"sample_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_filters" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_id" uuid,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"decision_note" text,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feed_discoveries_kind_check" CHECK (kind in ('ics', 'events_api', 'rss', 'page_data', 'html')),
	CONSTRAINT "feed_discoveries_status_check" CHECK (status in ('proposed', 'approved', 'rejected', 'gone')),
	CONSTRAINT "feed_discoveries_robots_check" CHECK (robots_result in ('allowed', 'disallowed', 'no_robots', 'error')),
	CONSTRAINT "feed_discoveries_url_check" CHECK (url ~ '^https://'),
	CONSTRAINT "feed_discoveries_samples_check" CHECK (jsonb_typeof(sample_events) = 'array' and jsonb_array_length(sample_events) <= 5),
	CONSTRAINT "feed_discoveries_robots_approved_check" CHECK (status <> 'approved' or robots_result <> 'disallowed'),
	CONSTRAINT "feed_discoveries_source_check" CHECK ((status <> 'approved' or source_id is not null) and (status <> 'proposed' or source_id is null)),
	CONSTRAINT "feed_discoveries_decided_check" CHECK ((status in ('approved', 'rejected')) <= (decided_at is not null) and (decided_at is null) = (decided_by is null))
);
--> statement-breakpoint
ALTER TABLE "feed_discoveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organizers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"organizer_type" text NOT NULL,
	"website" text,
	"city" text,
	"county" text,
	"channel" text DEFAULT 'unknown' NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"notes" text,
	"venue_id" uuid,
	"verification" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizers_slug_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "organizers_type_check" CHECK (organizer_type in ('government', 'parks_department', 'fire_department', 'library', 'museum', 'venue', 'downtown_organization', 'chamber', 'festival_organizer', 'race_organizer', 'nonprofit', 'business')),
	CONSTRAINT "organizers_channel_check" CHECK (channel in ('feed', 'structured_page', 'html_page', 'social_only', 'newsletter', 'unknown')),
	CONSTRAINT "organizers_status_check" CHECK (status in ('candidate', 'verified', 'retired')),
	CONSTRAINT "organizers_county_check" CHECK (county is null or county in ('Benton', 'Washington')),
	CONSTRAINT "organizers_website_check" CHECK (website is null or website ~ '^https://'),
	CONSTRAINT "organizers_verified_check" CHECK (status <> 'verified' or last_checked_at is not null)
);
--> statement-breakpoint
ALTER TABLE "organizers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "benchmark_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_id" uuid NOT NULL,
	"name" text NOT NULL,
	"event_date" date NOT NULL,
	"result" text NOT NULL,
	"matched_event_id" uuid,
	"matched_proposal_id" uuid,
	"matched_at" timestamp with time zone NOT NULL,
	"miss_reason" text,
	"task_status" text,
	"task_organizer_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benchmark_items_result_check" CHECK (result in ('live', 'review', 'shadow', 'missed')),
	CONSTRAINT "benchmark_items_miss_reason_check" CHECK (miss_reason is null or (result = 'missed' and miss_reason in ('no_source', 'social_only', 'not_in_feed', 'filtered', 'rejected', 'wrong_details', 'other'))),
	CONSTRAINT "benchmark_items_task_status_check" CHECK (task_status is null or (miss_reason = 'no_source' and task_status in ('open', 'done', 'dropped'))),
	CONSTRAINT "benchmark_items_match_check" CHECK (case result when 'live' then matched_event_id is not null and matched_proposal_id is null when 'missed' then matched_event_id is null and matched_proposal_id is null else matched_proposal_id is not null and matched_event_id is null end),
	CONSTRAINT "benchmark_items_name_check" CHECK (length(trim(name)) between 2 and 300)
);
--> statement-breakpoint
ALTER TABLE "benchmark_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "benchmark_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start" date NOT NULL,
	"label" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benchmark_weeks_monday_check" CHECK (extract(isodow from week_start) = 1)
);
--> statement-breakpoint
ALTER TABLE "benchmark_weeks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "organizer_id" uuid;--> statement-breakpoint
ALTER TABLE "feed_discoveries" ADD CONSTRAINT "feed_discoveries_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_discoveries" ADD CONSTRAINT "feed_discoveries_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_discoveries" ADD CONSTRAINT "feed_discoveries_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizers" ADD CONSTRAINT "organizers_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_items" ADD CONSTRAINT "benchmark_items_week_id_benchmark_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."benchmark_weeks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_items" ADD CONSTRAINT "benchmark_items_matched_event_id_events_id_fk" FOREIGN KEY ("matched_event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_items" ADD CONSTRAINT "benchmark_items_matched_proposal_id_event_proposals_id_fk" FOREIGN KEY ("matched_proposal_id") REFERENCES "public"."event_proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_items" ADD CONSTRAINT "benchmark_items_task_organizer_id_organizers_id_fk" FOREIGN KEY ("task_organizer_id") REFERENCES "public"."organizers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feed_discoveries_organizer_url_uniq" ON "feed_discoveries" USING btree ("organizer_id","url");--> statement-breakpoint
CREATE INDEX "feed_discoveries_proposed_idx" ON "feed_discoveries" USING btree ("created_at") WHERE "feed_discoveries"."status" = 'proposed';--> statement-breakpoint
CREATE UNIQUE INDEX "organizers_slug_uniq" ON "organizers" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "organizers_name_trgm_idx" ON "organizers" USING gin ("name" extensions.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "organizers_venue_idx" ON "organizers" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "benchmark_items_week_idx" ON "benchmark_items" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "benchmark_items_open_task_idx" ON "benchmark_items" USING btree ("created_at") WHERE "benchmark_items"."task_status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "benchmark_weeks_week_label_uniq" ON "benchmark_weeks" USING btree ("week_start",coalesce("label", ''));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_organizer_idx" ON "events" USING btree ("organizer_id");