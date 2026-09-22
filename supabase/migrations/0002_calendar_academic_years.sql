-- =============================================================================
-- Calendar Engine — Migration 0002: Academic Years
-- Supersedes the academic-year half of 03_Database_Design.md's old
-- "Migration 004: Academic Structure" (PLANNING/ACTIVE/FINALIZATION/ARCHIVED
-- -> PREPARING/READY/ACTIVE/CLOSED; no more academic_years.school_weekdays).
-- =============================================================================

CREATE TABLE academic_years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year_ec INT NOT NULL UNIQUE CHECK (year_ec BETWEEN 1900 AND 2500),
    name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    -- True until the admin replaces the Meskerem-5 -> Sene-30 default with
    -- the real Ministry-plan dates (mission §5). Never a second boundary —
    -- start_date/end_date above ARE the default until this flips to FALSE.
    is_default_boundary BOOLEAN NOT NULL DEFAULT TRUE,
    status academic_year_status NOT NULL DEFAULT 'PREPARING',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_academic_year_range CHECK (start_date <= end_date)
);

-- "Exactly one useful ACTIVE academic year" (mission §5), enforced
-- declaratively: a second row trying to become ACTIVE while one already is
-- hits a unique_violation (23505) at the database level, not just in
-- application code.
CREATE UNIQUE INDEX idx_academic_years_one_active
    ON academic_years ((TRUE)) WHERE status = 'ACTIVE';

CREATE INDEX idx_academic_years_status ON academic_years(status);

CREATE TRIGGER trg_academic_years_updated_at
    BEFORE UPDATE ON academic_years
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_academic_years_audit
    AFTER INSERT OR UPDATE OR DELETE ON academic_years
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;

CREATE POLICY academic_years_select_authenticated ON academic_years
    FOR SELECT TO authenticated
    USING (has_permission('calendar.view'));

CREATE POLICY academic_years_insert_manage ON academic_years
    FOR INSERT TO authenticated
    WITH CHECK (has_permission('calendar.manage'));

-- Ordinary UPDATE is blocked once CLOSED (mission §36) — even for someone
-- holding calendar.manage. The only path past a CLOSED year is the
-- fn_apply_calendar_correction() RPC (Migration 0013), which is
-- SECURITY DEFINER and re-checks calendar.correct_history itself rather
-- than going through this policy at all.
CREATE POLICY academic_years_update_manage ON academic_years
    FOR UPDATE TO authenticated
    USING (has_permission('calendar.manage') AND status <> 'CLOSED')
    WITH CHECK (has_permission('calendar.manage'));

-- No DELETE policy is defined on purpose — academic years are never
-- deleted through the ordinary API (school history persists indefinitely).
