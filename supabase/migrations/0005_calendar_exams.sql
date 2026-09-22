-- =============================================================================
-- Calendar Engine — Migration 0005: Exam Instances
-- Supersedes the old generic `non_school_days` EXAM rows (mission §9, §49).
-- =============================================================================

CREATE TABLE exam_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    exam_type_key exam_type_key NOT NULL REFERENCES exam_types(key),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (academic_year_id, exam_type_key),
    CONSTRAINT chk_exam_range CHECK (start_date <= end_date)
);

CREATE INDEX idx_exam_instances_year_dates ON exam_instances(academic_year_id, start_date, end_date);

CREATE TRIGGER trg_exam_instances_updated_at
    BEFORE UPDATE ON exam_instances
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_exam_instances_audit
    AFTER INSERT OR UPDATE OR DELETE ON exam_instances
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- The two hard stops from mission §9, enforced at the database layer as
-- well as in exams.ts's checkExamHardStops() — an exam window may not
-- include a Saturday, a Sunday, or a date on which a holiday closes the
-- school. Rejected outright; never merely flagged.
CREATE OR REPLACE FUNCTION fn_validate_exam_placement() RETURNS TRIGGER AS $$
DECLARE
    d DATE;
BEGIN
    d := NEW.start_date;
    WHILE d <= NEW.end_date LOOP
        IF EXTRACT(DOW FROM d) IN (0, 6) THEN
            RAISE EXCEPTION 'Exam % window includes weekend date %', NEW.exam_type_key, d
                USING ERRCODE = 'check_violation', HINT = 'CALENDAR_EXAM_ON_WEEKEND';
        END IF;

        IF EXISTS (
            SELECT 1 FROM holiday_occurrences h
            WHERE h.academic_year_id = NEW.academic_year_id
              AND h.date = d
              AND h.closes_school
        ) THEN
            RAISE EXCEPTION 'Exam % window includes a school-closing holiday on %', NEW.exam_type_key, d
                USING ERRCODE = 'check_violation', HINT = 'CALENDAR_EXAM_ON_CLOSING_HOLIDAY';
        END IF;

        d := d + 1; -- date + integer = date in Postgres; stays date-only, no timezone risk
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_exam_instances_validate
    BEFORE INSERT OR UPDATE ON exam_instances
    FOR EACH ROW EXECUTE FUNCTION fn_validate_exam_placement();

ALTER TABLE exam_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY exam_instances_select_authenticated ON exam_instances
    FOR SELECT TO authenticated
    USING (has_permission('calendar.view'));

CREATE POLICY exam_instances_insert_manage ON exam_instances
    FOR INSERT TO authenticated
    WITH CHECK (has_permission('calendar.manage_exams'));

CREATE POLICY exam_instances_update_manage ON exam_instances
    FOR UPDATE TO authenticated
    USING (
        has_permission('calendar.manage_exams')
        AND EXISTS (SELECT 1 FROM academic_years y WHERE y.id = exam_instances.academic_year_id AND y.status <> 'CLOSED')
    )
    WITH CHECK (has_permission('calendar.manage_exams'));

CREATE POLICY exam_instances_delete_manage ON exam_instances
    FOR DELETE TO authenticated
    USING (
        has_permission('calendar.manage_exams')
        AND EXISTS (SELECT 1 FROM academic_years y WHERE y.id = exam_instances.academic_year_id AND y.status <> 'CLOSED')
    );
