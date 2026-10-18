CREATE TABLE "weather_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nws_id" text NOT NULL,
	"event" text NOT NULL,
	"severity" text,
	"onset_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"link" text,
	"geometry" jsonb,
	"zones" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "weather_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "weather_cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"lat" numeric(9, 6) NOT NULL,
	"lng" numeric(9, 6) NOT NULL,
	"coord_source" jsonb NOT NULL,
	"nws_office" text,
	"nws_grid_x" integer,
	"nws_grid_y" integer,
	"station_id" text,
	"points_checked_at" timestamp with time zone,
	"reading" jsonb,
	"reading_fetched_at" timestamp with time zone,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weather_cities_slug_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "weather_cities_grid_check" CHECK ((nws_office is null) = (nws_grid_x is null) and (nws_office is null) = (nws_grid_y is null))
);
--> statement-breakpoint
ALTER TABLE "weather_cities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "weather_grids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"office" text NOT NULL,
	"grid_x" integer NOT NULL,
	"grid_y" integer NOT NULL,
	"hours" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nws_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "weather_grids" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "outdoor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "nws_office" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "nws_grid_x" integer;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "nws_grid_y" integer;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "nws_forecast_zone" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "nws_county_zone" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "nws_points_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "weather_alerts" ADD CONSTRAINT "weather_alerts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_cities" ADD CONSTRAINT "weather_cities_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weather_grids" ADD CONSTRAINT "weather_grids_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "weather_alerts_nws_id_uniq" ON "weather_alerts" USING btree ("nws_id");--> statement-breakpoint
CREATE INDEX "weather_alerts_last_seen_idx" ON "weather_alerts" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "weather_cities_slug_uniq" ON "weather_cities" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "weather_grids_square_uniq" ON "weather_grids" USING btree ("office","grid_x","grid_y");--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_nws_grid_check" CHECK ((nws_office is null) = (nws_grid_x is null) and (nws_office is null) = (nws_grid_y is null));