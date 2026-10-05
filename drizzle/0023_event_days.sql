CREATE TABLE "event_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"day" date NOT NULL,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_days_hours_check" CHECK (closes_at is null or opens_at is null or closes_at > opens_at)
);
--> statement-breakpoint
ALTER TABLE "event_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_days" ADD CONSTRAINT "event_days_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_days_event_day_uniq" ON "event_days" USING btree ("event_id","day");