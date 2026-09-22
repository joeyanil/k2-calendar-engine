-- =============================================================================
-- Calendar Engine — Migration 0014: Table Grants
--
-- RLS policies (Migrations 0001-0011) define which ROWS a role can see or
-- touch; Postgres separately requires the role to have the underlying
-- table-level privilege in the first place, or every query fails with
-- "permission denied for table X" before RLS is even evaluated.
--
-- On a Supabase-managed project this is normally already handled by the
-- platform's own default privileges for `anon`/`authenticated`/
-- `service_role` on the `public` schema. This migration states the grants
-- explicitly anyway so the schema is self-contained and behaves identically
-- on any plain PostgreSQL instance (exactly how this repo's own local test
-- database — no Supabase platform involved — was verified).
-- =============================================================================

GRANT SELECT, INSERT, UPDATE ON
    academic_years,
    semesters,
    student_return_days,
    calendar_dependencies,
    calendar_timeline_builds,
    calendar_timeline_days,
    calendar_validation_runs
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
    holiday_occurrences,
    exam_instances
TO authenticated;

-- Read-only for authenticated: catalogs (already REVOKEd write access in
-- Migration 0001) and the immutable correction/reminder trails.
GRANT SELECT ON holiday_types, exam_types, calendar_corrections, calendar_reminders TO authenticated;

-- service_role (background jobs, e.g. the daily reminder dispatcher) needs
-- full read/write and bypasses RLS entirely per its BYPASSRLS attribute,
-- matching every other background job in 06_Backend_Architecture.md §11.
GRANT ALL ON
    academic_years, semesters, holiday_occurrences, exam_instances, student_return_days,
    calendar_dependencies, calendar_timeline_builds, calendar_timeline_days,
    calendar_validation_runs, calendar_corrections, calendar_reminders,
    holiday_types, exam_types
TO service_role;
