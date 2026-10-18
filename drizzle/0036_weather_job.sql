CREATE TABLE "weather_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"alerts_fetched_at" timestamp with time zone,
	"blocked_at" timestamp with time zone,
	"blocked_reason" text,
	"run_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weather_state_single_check" CHECK (id = 1),
	CONSTRAINT "weather_state_blocked_check" CHECK ((blocked_at is null) = (blocked_reason is null))
);
--> statement-breakpoint
ALTER TABLE "weather_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_job_check";--> statement-breakpoint
ALTER TABLE "weather_state" ADD CONSTRAINT "weather_state_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_job_check" CHECK (job in ('fetch', 'process', 'maintenance', 'digest_draft', 'digest_recheck', 'publish', 'seed', 'manual', 'weather'));