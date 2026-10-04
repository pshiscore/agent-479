ALTER TABLE "venue_external_ids" ADD COLUMN "sub_space" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "former_addresses" text[] DEFAULT '{}'::text[] NOT NULL;