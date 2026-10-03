-- Supabase convention: extensions live in the "extensions" schema, which is on
-- the default search_path. gen_random_uuid() is built into Postgres 13+, so
-- pgcrypto isn't needed.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
