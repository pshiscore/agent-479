ALTER TABLE "agent_actions" DROP CONSTRAINT "agent_actions_action_check";--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "default_price_note" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "default_price_note_source" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "free_basis" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "age_min" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "age_max" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "grade_min" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "grade_max" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "registration_required" boolean;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_action_check" CHECK (action in ('insert', 'update', 'merge', 'unmerge', 'disable', 'enable', 'propose_venue', 'propose_link', 'propose_category', 'publish', 'hold', 'veto', 'recheck_drop', 'recheck_correct', 'rollback'));--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_price_note_check" CHECK ((default_price_note is null) = (default_price_note_source is null));--> statement-breakpoint
-- Data: every event marked free so far was free because its own listing said so.
UPDATE "events" SET "free_basis" = 'stated' WHERE "is_free";--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_free_basis_check" CHECK (coalesce(is_free, false) = (free_basis is not null));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_free_basis_value_check" CHECK (free_basis is null or free_basis in ('stated', 'source_default'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_age_check" CHECK ((age_min is null or age_min between 0 and 120) and (age_max is null or age_max between 0 and 120) and (age_min is null or age_max is null or age_max >= age_min) and (grade_min is null or grade_min between 0 and 12) and (grade_max is null or grade_max between 0 and 12) and (grade_min is null or grade_max is null or grade_max >= grade_min));