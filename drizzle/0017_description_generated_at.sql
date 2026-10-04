ALTER TABLE "events" ADD COLUMN "description_generated_at" timestamp with time zone;--> statement-breakpoint
-- Backfill: when each existing description was written, from the logged event
-- action that last set it (insert or update), else the event's last update.
UPDATE "events" e SET "description_generated_at" = coalesce(
  (SELECT max(a.created_at) FROM "agent_actions" a
    WHERE a.entity_type = 'event' AND a.entity_id = e.id AND a.action IN ('insert', 'update')
      AND a.after->>'shortDescription' = e.short_description),
  e.updated_at)
WHERE e.short_description IS NOT NULL;
-- The check that ties the two together is added in 0019, after the code that
-- sets description_generated_at is deployed (the code deployed before it
-- writes descriptions without the timestamp).
