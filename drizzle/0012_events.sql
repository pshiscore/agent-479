CREATE TABLE "event_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"raw_record_id" uuid,
	"external_id" text NOT NULL,
	"source_url" text,
	"ticket_url" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "event_tags" (
	"event_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_tags_event_id_tag_id_pk" PRIMARY KEY("event_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "event_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"short_description" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"time_tba" boolean DEFAULT false NOT NULL,
	"venue_id" uuid NOT NULL,
	"sub_space" text,
	"category_id" uuid NOT NULL,
	"series_id" uuid,
	"is_free" boolean,
	"price_min" numeric(10, 2),
	"price_max" numeric(10, 2),
	"price_text" text,
	"primary_source_url" text,
	"ticket_url" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"canonical_event_id" uuid,
	"quality_score" numeric(5, 3),
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_status_check" CHECK (status in ('scheduled', 'cancelled', 'postponed', 'merged', 'hidden')),
	CONSTRAINT "events_slug_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "events_end_check" CHECK (end_at is null or end_at >= start_at),
	CONSTRAINT "events_price_check" CHECK ((price_min is null or price_min >= 0) and (price_max is null or price_min is null or price_max >= price_min)),
	CONSTRAINT "events_merged_check" CHECK ((status = 'merged') = (canonical_event_id is not null)),
	CONSTRAINT "events_canonical_check" CHECK (canonical_event_id is null or canonical_event_id <> id)
);
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "raw_records" ADD COLUMN "facts" jsonb;--> statement-breakpoint
ALTER TABLE "raw_records" ADD COLUMN "venue_id" uuid;--> statement-breakpoint
ALTER TABLE "raw_records" ADD COLUMN "sub_space" text;--> statement-breakpoint
ALTER TABLE "raw_records" ADD COLUMN "venue_matched_by" text;--> statement-breakpoint
ALTER TABLE "raw_records" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_raw_record_id_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."raw_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_canonical_event_id_events_id_fk" FOREIGN KEY ("canonical_event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_sources_source_external_uniq" ON "event_sources" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "event_sources_event_idx" ON "event_sources" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_sources_primary_uniq" ON "event_sources" USING btree ("event_id") WHERE "event_sources"."is_primary";--> statement-breakpoint
CREATE INDEX "event_tags_tag_idx" ON "event_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_slug_uniq" ON "events" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "events_scheduled_start_idx" ON "events" USING btree ("start_at") WHERE "events"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "events_venue_start_idx" ON "events" USING btree ("venue_id","start_at");--> statement-breakpoint
CREATE INDEX "events_category_start_idx" ON "events" USING btree ("category_id","start_at");--> statement-breakpoint
CREATE INDEX "events_series_start_idx" ON "events" USING btree ("series_id","start_at");--> statement-breakpoint
CREATE INDEX "events_title_trgm_idx" ON "events" USING gin ("normalized_title" extensions.gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "raw_records" ADD CONSTRAINT "raw_records_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_records" ADD CONSTRAINT "raw_records_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_records" ADD CONSTRAINT "raw_records_needs_venue_check" CHECK (status <> 'needs_venue' or location_key is not null);--> statement-breakpoint
ALTER TABLE "raw_records" ADD CONSTRAINT "raw_records_mapped_check" CHECK (status not in ('mapped', 'extracted') or (facts is not null and venue_id is not null));