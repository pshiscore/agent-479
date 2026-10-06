ALTER TABLE "events" ADD COLUMN "parent_event_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_parent_event_id_events_id_fk" FOREIGN KEY ("parent_event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_parent_idx" ON "events" USING btree ("parent_event_id") WHERE "events"."parent_event_id" is not null;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_parent_check" CHECK (parent_event_id is null or parent_event_id <> id);