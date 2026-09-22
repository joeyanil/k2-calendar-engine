-- =============================================================================
-- Calendar Engine — Migration 0004: Holiday Occurrences
-- Supersedes 03_Database_Design.md's `seedNationalHolidays()` /
-- Bahire-Hasab auto-calculation of movable holidays (mission §8, §49).
-- =============================================================================

CREATE TABLE holiday_occurrences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    holiday_type_key holiday_type_key NOT NULL REFERENCES holiday_types(key),
    date DATE NOT NULL,
    -- Defaults closed; independently toggleable per year (mission §8).
    closes_school BOOLEAN NOT NULL DEFAULT TRUE,
    source holiday_source NOT NULL,
    confirmed_by UUID REFERENCES users(id),
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- One occurrence per holiday type per year — never two Timkat dates in
    -- the same academic year.
    UNIQUE (academic_year_id, holiday_type_key)
);

CREATE INDEX idx_holiday_occurrences_year_date ON holiday_occurrences(academic_year_id, date);

CREATE TRIGGER trg_holiday_occurrences_updated_at
    BEFORE UPDATE ON holiday_occurrences
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_holiday_occurrences_audit
    AFTER INSERT OR UPDATE OR DELETE ON holiday_occurrences
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- THE hard rule from mission §8: a movable holiday's date can never enter
-- the database any other way than an admin typing it in. There is no
-- AUTO_PROPOSED path for SIKLET / FASIKA / EID_FITR / EID_ADHA — this
-- trigger makes that a database-level guarantee, not just an application
-- convention that a future script could quietly bypass.
CREATE OR REPLACE FUNCTION fn_validate_holiday_occurrence() RETURNS TRIGGER AS $$
DECLARE
    v_movable BOOLEAN;
BEGIN
    SELECT movable INTO v_movable FROM holiday_types WHERE key = NEW.holiday_type_key;
    IF v_movable AND NEW.source <> 'ADMIN_ENTERED' THEN
        RAISE EXCEPTION 'Movable holiday % must be entered manually (source=ADMIN_ENTERED), got %',
            NEW.holiday_type_key, NEW.source
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_MOVABLE_HOLIDAY_REQUIRES_MANUAL_DATE';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_holiday_occurrences_validate
    BEFORE INSERT OR UPDATE ON holiday_occurrences
    FOR EACH ROW EXECUTE FUNCTION fn_validate_holiday_occurrence();

ALTER TABLE holiday_occurrences ENABLE ROW LEVEL SECURITY;

CREATE POLICY holiday_occurrences_select_authenticated ON holiday_occurrences
    FOR SELECT TO authenticated
    USING (has_permission('calendar.view'));

CREATE POLICY holiday_occurrences_insert_manage ON holiday_occurrences
    FOR INSERT TO authenticated
    WITH CHECK (has_permission('calendar.manage_holidays'));

CREATE POLICY holiday_occurrences_update_manage ON holiday_occurrences
    FOR UPDATE TO authenticated
    USING (
        has_permission('calendar.manage_holidays')
        AND EXISTS (
            SELECT 1 FROM academic_years y
            WHERE y.id = holiday_occurrences.academic_year_id AND y.status <> 'CLOSED'
        )
    )
    WITH CHECK (has_permission('calendar.manage_holidays'));

CREATE POLICY holiday_occurrences_delete_manage ON holiday_occurrences
    FOR DELETE TO authenticated
    USING (
        has_permission('calendar.manage_holidays')
        AND EXISTS (
            SELECT 1 FROM academic_years y
            WHERE y.id = holiday_occurrences.academic_year_id AND y.status <> 'CLOSED'
        )
    );
