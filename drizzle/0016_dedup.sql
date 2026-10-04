CREATE TABLE "dedup_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_a_id" uuid NOT NULL,
	"event_b_id" uuid NOT NULL,
	"scores" jsonb NOT NULL,
	"decision" text NOT NULL,
	"mode" text NOT NULL,
	"confidence" numeric(4, 3),
	"llm_call_id" uuid,
	"run_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dedup_candidates_order_check" CHECK (event_a_id < event_b_id),
	CONSTRAINT "dedup_candidates_decision_check" CHECK (decision in ('auto_merge', 'llm_same', 'uncertain', 'distinct')),
	CONSTRAINT "dedup_candidates_mode_check" CHECK (mode in ('shadow', 'live')),
	CONSTRAINT "dedup_candidates_confidence_check" CHECK (confidence is null or (confidence >= 0 and confidence <= 1))
);
--> statement-breakpoint
ALTER TABLE "dedup_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "dedup_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"facts_a" jsonb NOT NULL,
	"facts_b" jsonb NOT NULL,
	"label" text NOT NULL,
	"source_ids" uuid[] NOT NULL,
	"labeled_by" text NOT NULL,
	"labeled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	CONSTRAINT "dedup_labels_label_check" CHECK (label in ('same', 'different')),
	CONSTRAINT "dedup_labels_by_check" CHECK (labeled_by ~ '^human:.+')
);
--> statement-breakpoint
ALTER TABLE "dedup_labels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dedup_candidates" ADD CONSTRAINT "dedup_candidates_event_a_id_events_id_fk" FOREIGN KEY ("event_a_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dedup_candidates" ADD CONSTRAINT "dedup_candidates_event_b_id_events_id_fk" FOREIGN KEY ("event_b_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dedup_candidates" ADD CONSTRAINT "dedup_candidates_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dedup_candidates" ADD CONSTRAINT "dedup_candidates_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dedup_labels" ADD CONSTRAINT "dedup_labels_candidate_id_dedup_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."dedup_candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dedup_candidates_pair_uniq" ON "dedup_candidates" USING btree ("event_a_id","event_b_id");--> statement-breakpoint
CREATE INDEX "dedup_candidates_b_idx" ON "dedup_candidates" USING btree ("event_b_id");--> statement-breakpoint
CREATE INDEX "dedup_candidates_decision_idx" ON "dedup_candidates" USING btree ("decision");--> statement-breakpoint
CREATE UNIQUE INDEX "dedup_labels_candidate_uniq" ON "dedup_labels" USING btree ("candidate_id");