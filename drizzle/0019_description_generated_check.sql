-- Added after the code that sets description_generated_at is live (0017 added
-- the column). A description and its timestamp are present together or not at all.
ALTER TABLE "events" ADD CONSTRAINT "events_description_generated_check" CHECK ((short_description is null) = (description_generated_at is null));
