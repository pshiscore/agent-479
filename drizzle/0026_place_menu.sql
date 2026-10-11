ALTER TABLE "places" ADD COLUMN "menu_url" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "menu_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_menu_check" CHECK ((menu_url is null) = (menu_checked_at is null));