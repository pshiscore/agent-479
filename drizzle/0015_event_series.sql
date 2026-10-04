CREATE TABLE "event_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"source_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"recurrence_label" text NOT NULL,
	"rrule" text,
	"detected_by" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_series_kind_check" CHECK (kind in ('recurring', 'run')),
	CONSTRAINT "event_series_detected_by_check" CHECK (detected_by in ('rrule', 'pattern')),
	CONSTRAINT "event_series_slug_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "event_series_rrule_check" CHECK ((detected_by = 'rrule') = (rrule is not null))
);
--> statement-breakpoint
ALTER TABLE "event_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_series_slug_uniq" ON "event_series" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "event_series_group_uniq" ON "event_series" USING btree ("source_id","venue_id","normalized_title");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_series_id_event_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."event_series"("id") ON DELETE restrict ON UPDATE no action;