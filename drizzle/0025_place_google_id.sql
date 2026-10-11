ALTER TABLE "places" ADD COLUMN "google_place_id" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "google_place_id_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "google_place_id_confirmed_by" text;--> statement-breakpoint
CREATE UNIQUE INDEX "places_google_place_id_uniq" ON "places" USING btree ("google_place_id") WHERE "places"."google_place_id" is not null;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_google_check" CHECK ((google_place_id is null) = (google_place_id_confirmed_at is null) and (google_place_id is null) = (google_place_id_confirmed_by is null));--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_google_id_check" CHECK (google_place_id is null or (google_place_id ~ '^[A-Za-z0-9_-]+$' and length(google_place_id) between 10 and 300));