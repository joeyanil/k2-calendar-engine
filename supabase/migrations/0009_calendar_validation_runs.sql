-- =============================================================================
-- Calendar Engine — Migration 0009: Validation Runs
-- mission §27-28. Persists the last computed validation state so the admin
-- UI can show "current/stale" validation status without recomputing on
-- every page load, and so validation history is inspectable.
-- =============================================================================

CREATE TYPE calendar_validation_severity AS ENUM ('MISSING', 'ERROR', 'WARNING', 'INFORMATION');

CREATE TABLE calendar_validation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    missing_count INT NOT NULL,
    error_count INT NOT NULL,
    warning_count INT NOT NULL,
    information_count INT NOT NULL,
    -- The full ValidationIssue[] array (validation.ts), stored verbatim so
    -- the UI can render exact messages/refs without recomputation.
    issues JSONB NOT NULL
);

CREATE INDEX idx_validation_runs_year_time ON calendar_validation_runs(academic_year_id, ran_at DESC);

ALTER TABLE calendar_validation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_validation_runs_select_authenticated ON calendar_validation_runs
    FOR SELECT TO authenticated
    USING (has_permission('calendar.view'));

-- Written only by the service layer (using the standard authenticated
-- write path — validation runs are cheap, frequent, and not part of the
-- "closed history" protection model, unlike the facts they describe).
CREATE POLICY calendar_validation_runs_insert_manage ON calendar_validation_runs
    FOR INSERT TO authenticated
    WITH CHECK (has_permission('calendar.view'));
