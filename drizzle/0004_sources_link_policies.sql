CREATE TABLE "link_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"mode" text NOT NULL,
	"homepage_url" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_policies_mode_check" CHECK (mode in ('deep', 'homepage_only')),
	CONSTRAINT "link_policies_domain_check" CHECK (domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' and domain !~ '^www\.'),
	CONSTRAINT "link_policies_homepage_check" CHECK (mode = 'deep' or homepage_url ~ '^https://')
);
--> statement-breakpoint
ALTER TABLE "link_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text,
	"fetcher" text,
	"base_url" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_venue_id" uuid,
	"trust_level" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"fetch_interval_minutes" integer NOT NULL,
	"commercial_use_ok" text DEFAULT 'unknown' NOT NULL,
	"terms_notes" text NOT NULL,
	"dedup_mode" text DEFAULT 'shadow' NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"robots_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_slug_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "sources_kind_check" CHECK (kind is null or kind in ('api', 'ics', 'rss', 'jsonld_sitemap', 'html')),
	CONSTRAINT "sources_enabled_check" CHECK (not enabled or (kind is not null and fetcher is not null)),
	CONSTRAINT "sources_trust_check" CHECK (trust_level between 1 and 5),
	CONSTRAINT "sources_interval_check" CHECK (fetch_interval_minutes >= 15),
	CONSTRAINT "sources_commercial_check" CHECK (commercial_use_ok in ('yes', 'no', 'unknown')),
	CONSTRAINT "sources_dedup_check" CHECK (dedup_mode in ('shadow', 'live')),
	CONSTRAINT "sources_failures_check" CHECK (consecutive_failures >= 0),
	CONSTRAINT "sources_base_url_check" CHECK (base_url ~ '^https://')
);
--> statement-breakpoint
ALTER TABLE "sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_default_venue_id_venues_id_fk" FOREIGN KEY ("default_venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "link_policies_domain_uniq" ON "link_policies" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_slug_uniq" ON "sources" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_external_ids" ADD CONSTRAINT "venue_external_ids_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;