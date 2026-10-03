CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"source_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	CONSTRAINT "runs_job_check" CHECK (job in ('fetch', 'process', 'maintenance', 'digest_draft', 'digest_recheck', 'publish', 'seed', 'manual')),
	CONSTRAINT "runs_status_check" CHECK (status in ('running', 'ok', 'partial', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"llm_model_id" uuid,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_calls_task_check" CHECK (task in ('extract', 'classify', 'describe', 'dedup_tiebreak', 'venue_pick', 'digest')),
	CONSTRAINT "llm_calls_status_check" CHECK (status in ('ok', 'error', 'invalid_output', 'refused_budget'))
);
--> statement-breakpoint
ALTER TABLE "llm_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "llm_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"max_output_tokens" integer,
	"input_cost_per_mtok" numeric(12, 6) NOT NULL,
	"cached_input_cost_per_mtok" numeric(12, 6),
	"cache_write_cost_per_mtok" numeric(12, 6),
	"output_cost_per_mtok" numeric(12, 6) NOT NULL,
	"pricing_source_url" text NOT NULL,
	"pricing_checked_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_models_task_check" CHECK (task in ('extract', 'classify', 'describe', 'dedup_tiebreak', 'venue_pick', 'digest'))
);
--> statement-breakpoint
ALTER TABLE "llm_models" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"actor" text NOT NULL,
	"job" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text NOT NULL,
	"model" text,
	"llm_call_id" uuid,
	"confidence" numeric(4, 3),
	"approval_status" text,
	"dedupe_key" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"reverts_action_id" uuid,
	"reverted_by_action_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_actions_action_check" CHECK (action in ('insert', 'update', 'merge', 'unmerge', 'disable', 'enable', 'propose_venue', 'publish', 'hold', 'veto', 'recheck_drop', 'recheck_correct', 'rollback')),
	CONSTRAINT "agent_actions_approval_check" CHECK (approval_status is null or approval_status in ('pending', 'approved', 'rejected')),
	CONSTRAINT "agent_actions_actor_check" CHECK (actor ~ '^(agent|human):.+'),
	CONSTRAINT "agent_actions_confidence_check" CHECK (confidence is null or (confidence >= 0 and confidence <= 1))
);
--> statement-breakpoint
ALTER TABLE "agent_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_llm_model_id_llm_models_id_fk" FOREIGN KEY ("llm_model_id") REFERENCES "public"."llm_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_reverts_action_id_agent_actions_id_fk" FOREIGN KEY ("reverts_action_id") REFERENCES "public"."agent_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_reverted_by_action_id_agent_actions_id_fk" FOREIGN KEY ("reverted_by_action_id") REFERENCES "public"."agent_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_job_started_idx" ON "runs" USING btree ("job","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "llm_calls_created_idx" ON "llm_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_task_created_idx" ON "llm_calls" USING btree ("task","created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_run_idx" ON "llm_calls" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_models_active_task_uniq" ON "llm_models" USING btree ("task") WHERE "llm_models"."active";--> statement-breakpoint
CREATE INDEX "agent_actions_entity_idx" ON "agent_actions" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_actions_run_idx" ON "agent_actions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_actions_created_idx" ON "agent_actions" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_actions_pending_idx" ON "agent_actions" USING btree ("created_at") WHERE "agent_actions"."approval_status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "agent_actions_pending_dedupe_uniq" ON "agent_actions" USING btree ("action","dedupe_key") WHERE "agent_actions"."approval_status" = 'pending';