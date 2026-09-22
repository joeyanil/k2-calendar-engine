-- =============================================================================
-- DEV-ONLY FIXTURE — simulates the parts of Supabase's built-in `auth` schema
-- that RLS policies in this repo rely on (`auth.uid()`).
--
-- This file is NOT part of the Calendar Engine's deliverable migrations
-- (supabase/migrations/). A real Supabase project already provides `auth.uid()`
-- from its own GoTrue-backed `auth` schema — this stub exists purely so the
-- migrations under supabase/migrations/ can be applied and exercised against
-- a plain local PostgreSQL instance (this sandbox has no Docker, so the real
-- `supabase start` local-dev flow isn't available here).
--
-- Usage in a test session:
--   SELECT set_config('app.current_uid', '<uuid>', false);
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_uid', true), '')::UUID;
$$;
