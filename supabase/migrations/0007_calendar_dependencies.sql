-- =============================================================================
-- Calendar Engine — Migration 0007: Dependency Model
-- Deep Domain File 2 §E, mission §33-34.
--
-- A dependency's anchor/dependent are encoded as a "fact reference": a kind
-- column plus whichever companion column that kind actually needs (semester
-- order / holiday type / exam type — or none, for the year-boundary kinds).
-- This mirrors CalendarFactRef in src/lib/calendar/types.ts exactly.
-- =============================================================================

CREATE TABLE calendar_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,

    anchor_kind calendar_fact_kind NOT NULL,
    anchor_semester_order SMALLINT CHECK (anchor_semester_order IN (1, 2)),
    anchor_holiday_type_key holiday_type_key,
    anchor_exam_type_key exam_type_key,

    dependent_kind calendar_fact_kind NOT NULL,
    dependent_semester_order SMALLINT CHECK (dependent_semester_order IN (1, 2)),
    dependent_holiday_type_key holiday_type_key,
    dependent_exam_type_key exam_type_key,

    offset_days INT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_calendar_dependencies_year ON calendar_dependencies(academic_year_id) WHERE active;
CREATE INDEX idx_calendar_dependencies_anchor
    ON calendar_dependencies(academic_year_id, anchor_kind, anchor_semester_order, anchor_holiday_type_key, anchor_exam_type_key)
    WHERE active;

-- Each fact-ref kind carries exactly the companion column(s) it needs and
-- no others — mirrors factRefKey()'s discriminated union in TypeScript.
CREATE OR REPLACE FUNCTION fn_validate_fact_ref(
    p_kind calendar_fact_kind, p_semester_order SMALLINT, p_holiday_key holiday_type_key, p_exam_key exam_type_key, p_label TEXT
) RETURNS VOID AS $$
BEGIN
    CASE p_kind
        WHEN 'SEMESTER_START', 'SEMESTER_END' THEN
            IF p_semester_order IS NULL OR p_holiday_key IS NOT NULL OR p_exam_key IS NOT NULL THEN
                RAISE EXCEPTION '% fact ref of kind % must set only semester_order', p_label, p_kind
                    USING ERRCODE = 'check_violation';
            END IF;
        WHEN 'HOLIDAY_OCCURRENCE' THEN
            IF p_holiday_key IS NULL OR p_semester_order IS NOT NULL OR p_exam_key IS NOT NULL THEN
                RAISE EXCEPTION '% fact ref of kind % must set only holiday_type_key', p_label, p_kind
                    USING ERRCODE = 'check_violation';
            END IF;
        WHEN 'EXAM_START', 'EXAM_END' THEN
            IF p_exam_key IS NULL OR p_semester_order IS NOT NULL OR p_holiday_key IS NOT NULL THEN
                RAISE EXCEPTION '% fact ref of kind % must set only exam_type_key', p_label, p_kind
                    USING ERRCODE = 'check_violation';
            END IF;
        ELSE -- ACADEMIC_YEAR_START, ACADEMIC_YEAR_END, STUDENT_RETURN
            IF p_semester_order IS NOT NULL OR p_holiday_key IS NOT NULL OR p_exam_key IS NOT NULL THEN
                RAISE EXCEPTION '% fact ref of kind % must set no companion columns', p_label, p_kind
                    USING ERRCODE = 'check_violation';
            END IF;
    END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION fn_validate_calendar_dependency() RETURNS TRIGGER AS $$
DECLARE
    v_cycle_found BOOLEAN;
BEGIN
    PERFORM fn_validate_fact_ref(NEW.anchor_kind, NEW.anchor_semester_order, NEW.anchor_holiday_type_key, NEW.anchor_exam_type_key, 'anchor');
    PERFORM fn_validate_fact_ref(NEW.dependent_kind, NEW.dependent_semester_order, NEW.dependent_holiday_type_key, NEW.dependent_exam_type_key, 'dependent');

    IF NEW.anchor_kind = NEW.dependent_kind
       AND NEW.anchor_semester_order IS NOT DISTINCT FROM NEW.dependent_semester_order
       AND NEW.anchor_holiday_type_key IS NOT DISTINCT FROM NEW.dependent_holiday_type_key
       AND NEW.anchor_exam_type_key IS NOT DISTINCT FROM NEW.dependent_exam_type_key THEN
        RAISE EXCEPTION 'A calendar fact cannot depend on itself'
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_CIRCULAR_DEPENDENCY';
    END IF;

    IF NOT NEW.active THEN
        RETURN NEW; -- an inactive rule can't contribute to a live cycle
    END IF;

    -- Cycle check: walk dependent -> anchor edges starting at NEW.dependent;
    -- if NEW.anchor is reachable, this edge would close a loop (mission
    -- §34 — mirrors dependencyGraph.ts's wouldCreateCycle()).
    WITH RECURSIVE reachable AS (
        SELECT dependent_kind AS k, dependent_semester_order AS so,
               dependent_holiday_type_key AS hk, dependent_exam_type_key AS ek
        FROM calendar_dependencies
        WHERE academic_year_id = NEW.academic_year_id AND active
          AND anchor_kind = NEW.dependent_kind
          AND anchor_semester_order IS NOT DISTINCT FROM NEW.dependent_semester_order
          AND anchor_holiday_type_key IS NOT DISTINCT FROM NEW.dependent_holiday_type_key
          AND anchor_exam_type_key IS NOT DISTINCT FROM NEW.dependent_exam_type_key
        UNION
        SELECT cd.dependent_kind, cd.dependent_semester_order, cd.dependent_holiday_type_key, cd.dependent_exam_type_key
        FROM calendar_dependencies cd
        JOIN reachable r
          ON cd.academic_year_id = NEW.academic_year_id AND cd.active
         AND cd.anchor_kind = r.k
         AND cd.anchor_semester_order IS NOT DISTINCT FROM r.so
         AND cd.anchor_holiday_type_key IS NOT DISTINCT FROM r.hk
         AND cd.anchor_exam_type_key IS NOT DISTINCT FROM r.ek
    )
    SELECT EXISTS (
        SELECT 1 FROM reachable
        WHERE k = NEW.anchor_kind
          AND so IS NOT DISTINCT FROM NEW.anchor_semester_order
          AND hk IS NOT DISTINCT FROM NEW.anchor_holiday_type_key
          AND ek IS NOT DISTINCT FROM NEW.anchor_exam_type_key
    ) INTO v_cycle_found;

    IF v_cycle_found THEN
        RAISE EXCEPTION 'Circular calendar dependency detected involving %', NEW.dependent_kind
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_CIRCULAR_DEPENDENCY';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calendar_dependencies_validate
    BEFORE INSERT OR UPDATE ON calendar_dependencies
    FOR EACH ROW EXECUTE FUNCTION fn_validate_calendar_dependency();

ALTER TABLE calendar_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_dependencies_select_authenticated ON calendar_dependencies
    FOR SELECT TO authenticated
    USING (has_permission('calendar.view'));

CREATE POLICY calendar_dependencies_insert_manage ON calendar_dependencies
    FOR INSERT TO authenticated
    WITH CHECK (has_permission('calendar.manage_dependencies'));

CREATE POLICY calendar_dependencies_update_manage ON calendar_dependencies
    FOR UPDATE TO authenticated
    USING (has_permission('calendar.manage_dependencies'))
    WITH CHECK (has_permission('calendar.manage_dependencies'));
