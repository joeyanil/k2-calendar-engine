-- =============================================================================
-- Calendar Engine — Migration 0017: Dependency Integrity
--
-- v2 zero-trust repair, Phase 3 (fixes #8, #12, #24 — the database side; the
-- TypeScript side — actual resolution wired into the build pipeline, the
-- real impact preview, and the "no silent second authority" edit guard —
-- lives in dependencyResolution.ts and the service-layer changes alongside
-- this migration).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Fix #12 — a calendar fact must have at most one ACTIVE incoming
-- dependency, enforced at the database, not only in the TypeScript service
-- (calendarDependency.service.ts's assertNoConflictingIncomingRules is the
-- fast-fail pre-check; this is the real gate for any direct-database
-- write). Mirrors the existing cycle-detection trigger's structure exactly.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validate_calendar_dependency() RETURNS TRIGGER AS $$
DECLARE
    v_cycle_found BOOLEAN;
    v_conflict_count INT;
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
        RETURN NEW; -- an inactive rule can't contribute to a live cycle or conflict
    END IF;

    -- Fix #12: does another ACTIVE rule (other than this row, on UPDATE)
    -- already target the same dependent?
    SELECT count(*) INTO v_conflict_count
      FROM calendar_dependencies
     WHERE academic_year_id = NEW.academic_year_id AND active AND id IS DISTINCT FROM NEW.id
       AND dependent_kind = NEW.dependent_kind
       AND dependent_semester_order IS NOT DISTINCT FROM NEW.dependent_semester_order
       AND dependent_holiday_type_key IS NOT DISTINCT FROM NEW.dependent_holiday_type_key
       AND dependent_exam_type_key IS NOT DISTINCT FROM NEW.dependent_exam_type_key;
    IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'Fact % already has % active incoming dependency(ies) — a fact must have exactly one authoritative source', NEW.dependent_kind, v_conflict_count
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_CONFLICTING_DEPENDENCY';
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
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

-- -----------------------------------------------------------------------------
-- 2. Fix #24 — a CLOSED year's dependency relationships are historical
-- configuration; ordinary INSERT must respect that exactly like UPDATE
-- already does. (INSERT has no "old row" to compare against, so this is a
-- plain year-status check via a subquery, not the OLD/NEW pattern UPDATE
-- policies use elsewhere in this codebase.)
-- -----------------------------------------------------------------------------
DROP POLICY calendar_dependencies_insert_manage ON calendar_dependencies;
CREATE POLICY calendar_dependencies_insert_manage ON calendar_dependencies
    FOR INSERT TO authenticated
    WITH CHECK (
        has_permission('calendar.manage_dependencies')
        AND (SELECT status FROM academic_years WHERE id = academic_year_id) <> 'CLOSED'
    );
