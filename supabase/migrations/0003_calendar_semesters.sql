-- =============================================================================
-- Calendar Engine — Migration 0003: Semesters
-- Supersedes the semester half of the old "Migration 004: Academic
-- Structure" (2-or-4 semester configurability removed — mission §6; UPCOMING
-- -> ACTIVE -> LOCKED -> ARCHIVED lifecycle replaced, no unlockSemester()).
-- =============================================================================

CREATE TABLE semesters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    -- Exactly two semesters, always. Enforced two ways: this CHECK, and the
    -- UNIQUE(academic_year_id, sem_order) below which makes a third row for
    -- either order impossible.
    sem_order SMALLINT NOT NULL CHECK (sem_order IN (1, 2)),
    -- NULL is legitimate here — Missing, not Error (mission §27) — until the
    -- admin enters real dates.
    start_date DATE,
    end_date DATE,
    status semester_status NOT NULL DEFAULT 'UPCOMING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (academic_year_id, sem_order),
    CONSTRAINT chk_semester_range CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);

CREATE INDEX idx_semesters_year ON semesters(academic_year_id);

CREATE TRIGGER trg_semesters_updated_at
    BEFORE UPDATE ON semesters
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_semesters_audit
    AFTER INSERT OR UPDATE OR DELETE ON semesters
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- Semester 2 must not start before Semester 1 ends (semesterBreak.ts's
-- checkSemesterOrdering ERROR, enforced again here as a database invariant
-- once both boundaries are known).
CREATE OR REPLACE FUNCTION fn_validate_semester_ordering() RETURNS TRIGGER AS $$
DECLARE
    v_other semesters;
BEGIN
    IF NEW.start_date IS NULL AND NEW.end_date IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.sem_order = 2 AND NEW.start_date IS NOT NULL THEN
        SELECT * INTO v_other FROM semesters
         WHERE academic_year_id = NEW.academic_year_id AND sem_order = 1;
        IF FOUND AND v_other.end_date IS NOT NULL AND NEW.start_date < v_other.end_date THEN
            RAISE EXCEPTION 'Semester 2 start (%) is before Semester 1 end (%)', NEW.start_date, v_other.end_date
                USING ERRCODE = 'check_violation', HINT = 'CALENDAR_SEMESTERS_OVERLAP';
        END IF;
    ELSIF NEW.sem_order = 1 AND NEW.end_date IS NOT NULL THEN
        SELECT * INTO v_other FROM semesters
         WHERE academic_year_id = NEW.academic_year_id AND sem_order = 2;
        IF FOUND AND v_other.start_date IS NOT NULL AND v_other.start_date < NEW.end_date THEN
            RAISE EXCEPTION 'Semester 2 start (%) is before Semester 1 end (%)', v_other.start_date, NEW.end_date
                USING ERRCODE = 'check_violation', HINT = 'CALENDAR_SEMESTERS_OVERLAP';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_semesters_validate_ordering
    BEFORE INSERT OR UPDATE ON semesters
    FOR EACH ROW EXECUTE FUNCTION fn_validate_semester_ordering();

ALTER TABLE semesters ENABLE ROW LEVEL SECURITY;

CREATE POLICY semesters_select_authenticated ON semesters
    FOR SELECT TO authenticated
    USING (has_permission('calendar.view'));

CREATE POLICY semesters_insert_manage ON semesters
    FOR INSERT TO authenticated
    WITH CHECK (has_permission('calendar.manage'));

-- Blocked once the semester itself is CLOSED (mission §36) — formal
-- correction only, via fn_apply_calendar_correction().
CREATE POLICY semesters_update_manage ON semesters
    FOR UPDATE TO authenticated
    USING (has_permission('calendar.manage') AND status <> 'CLOSED')
    WITH CHECK (has_permission('calendar.manage'));
