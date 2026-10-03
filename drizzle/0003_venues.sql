CREATE TABLE "venue_external_ids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venue_external_ids" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"address" text,
	"city" text NOT NULL,
	"state" text DEFAULT 'AR' NOT NULL,
	"postal_code" text,
	"lat" numeric(9, 6) NOT NULL,
	"lng" numeric(9, 6) NOT NULL,
	"website" text,
	"venue_type" text NOT NULL,
	"parent_venue_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"verification" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_type_check" CHECK (venue_type in ('arena', 'theater', 'museum', 'music_venue', 'bar', 'park', 'library', 'plaza', 'campus', 'area', 'other')),
	CONSTRAINT "venues_address_check" CHECK (venue_type = 'area' or address is not null),
	CONSTRAINT "venues_lat_check" CHECK (lat between -90 and 90),
	CONSTRAINT "venues_lng_check" CHECK (lng between -180 and 180),
	CONSTRAINT "venues_state_check" CHECK (state ~ '^[A-Z]{2}$'),
	CONSTRAINT "venues_slug_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "venues_parent_check" CHECK (parent_venue_id is null or parent_venue_id <> id)
);
--> statement-breakpoint
ALTER TABLE "venues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "venue_external_ids" ADD CONSTRAINT "venue_external_ids_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_parent_venue_id_venues_id_fk" FOREIGN KEY ("parent_venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "venue_external_ids_source_external_uniq" ON "venue_external_ids" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "venue_external_ids_venue_idx" ON "venue_external_ids" USING btree ("venue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_slug_uniq" ON "venues" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "venues_aliases_gin_idx" ON "venues" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "venues_name_trgm_idx" ON "venues" USING gin ("name" extensions.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "venues_parent_idx" ON "venues" USING btree ("parent_venue_id");