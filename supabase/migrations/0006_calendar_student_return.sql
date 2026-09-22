-- =============================================================================
-- Calendar Engine — Migration 0006: Student Return / Orientation
-- mission §10. Deliberately its own table, never a row in a generic events
-- table (see LEGACY_REMOVAL.md).
-- =============================================================================

CREATE TABLE student_return_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Exactly one Student Return date per academic year.
    academic_year_id UUID NOT NULL UNIQUE REFERENCES academic_years(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_student_return_days_updated_at
    BEFORE UPDATE ON student_return_days
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_student_return_days_audit
    AFTER INSERT OR UPDATE OR DELETE ON student_return_days
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

ALTER TABLE student_return_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_return_days_select_authenticated ON student_return_days
    FOR SELECT TO authenticated
    USING (has_permission('calendar.view'));

CREATE POLICY student_return_days_insert_manage ON student_return_days
    FOR INSERT TO authenticated
    WITH CHECK (has_permission('calendar.manage'));

CREATE POLICY student_return_days_update_manage ON student_return_days
    FOR UPDATE TO authenticated
    USING (
        has_permission('calendar.manage')
        AND EXISTS (SELECT 1 FROM academic_years y WHERE y.id = student_return_days.academic_year_id AND y.status <> 'CLOSED')
    )
    WITH CHECK (has_permission('calendar.manage'));
