-- =============================================================================
-- Calendar Engine — Migration 0016: Lifecycle Integrity
--
-- v2 zero-trust repair, Phase 2 (fixes #5, #6, #7 from the repair guide).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Fix #5 — academic-year creation must create exactly two semesters,
-- atomically. Implemented as a trigger, not just a TypeScript transaction,
-- so the invariant holds regardless of caller: a direct SQL insert, a test
-- fixture, or the service layer all get it for free, and if this trigger
-- fails for any reason the WHOLE year-creation statement rolls back with
-- it — there is no code path that can leave a year with zero or one
-- semester. (An UPPER bound of exactly two was already structurally
-- guaranteed by sem_order's CHECK + the UNIQUE(academic_year_id, sem_order)
-- constraint; this closes the LOWER bound. Deletion is already impossible —
-- Migration 0014 never grants DELETE on semesters to authenticated.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_create_default_semesters()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO semesters (academic_year_id, sem_order, status)
    VALUES (NEW.id, 1, 'UPCOMING'), (NEW.id, 2, 'UPCOMING');
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_create_default_semesters
    AFTER INSERT ON academic_years
    FOR EACH ROW EXECUTE FUNCTION fn_create_default_semesters();

-- -----------------------------------------------------------------------------
-- 2. Fix #6 — lifecycle bypass via ordinary UPDATE. `status` on both
-- academic_years and semesters becomes reachable only through the
-- transition RPCs (which are SECURITY DEFINER and therefore unaffected by
-- the caller's own column privileges) — an ordinary `UPDATE academic_years
-- SET status = 'ACTIVE'` from an authenticated client can no longer even
-- attempt to include that column.
--
-- academic_years: Migration 0015 already converted this table's UPDATE
-- grant from table-level to column-level (needed for calendar_config_revision's
-- own protection) and deliberately left `status` grantable, noting this
-- fix would remove it here. Column-level REVOKE correctly subtracts from a
-- column-level GRANT (verified in Phase 1 testing — it does NOT subtract
-- from a table-level one, which is why 0015 had to convert it first).
-- -----------------------------------------------------------------------------
REVOKE UPDATE (status) ON academic_years FROM authenticated;

-- semesters never went through that conversion — still a blanket
-- table-level grant from 0014 — so the full revoke-then-column-regrant
-- pattern is needed here, same as 0015 needed for academic_years.
-- sem_order and academic_year_id are structural identity, never editable;
-- updated_at is trigger-managed (trg_semesters_updated_at).
REVOKE UPDATE ON semesters FROM authenticated;
GRANT UPDATE (start_date, end_date) ON semesters TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Fix #7 — activation must require calendar readiness.
--
-- Deliberate scope boundary, matching the same reasoning as the publish
-- RPC in Migration 0015: the FULL Missing/Error/Warning/Information
-- validation taxonomy (exam hard-stops, holiday-on-weekend, dependency
-- conflicts, cross-semester boundary checks, ...) is genuinely rich domain
-- logic that already lives correctly in TypeScript
-- (validateCalendarConfiguration) — re-deriving all of it in PL/pgSQL would
-- duplicate, and risk diverging from, that single source of truth. The
-- primary enforcement for the full rule therefore lives in the TypeScript
-- service layer (academicYear.service.ts), which now calls that validator
-- and blocks on any MISSING or ERROR severity issue before ever invoking
-- this RPC.
--
-- What THIS function adds is a minimal, high-confidence STRUCTURAL
-- backstop it can own without duplicating nuanced business rules: a year
-- cannot become READY or ACTIVE while either semester still has a NULL
-- start_date or end_date. This is not a judgment call — the timeline
-- builder cannot construct a timeline without semester dates, full stop —
-- so asserting it here is safe, and it means even a caller that invokes
-- this RPC directly, bypassing the TypeScript layer entirely, cannot
-- activate a year that is obviously, structurally incomplete.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_transition_academic_year_status(p_year_id UUID, p_to academic_year_status)
RETURNS academic_years
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_year academic_years;
    v_valid BOOLEAN;
    v_incomplete_semesters INT;
BEGIN
    IF NOT has_permission('calendar.manage') THEN
        RAISE EXCEPTION 'permission denied for calendar.manage' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_year FROM academic_years WHERE id = p_year_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Academic year % not found', p_year_id USING ERRCODE = 'no_data_found';
    END IF;

    v_valid := (v_year.status = 'PREPARING' AND p_to = 'READY')
            OR (v_year.status = 'READY' AND p_to = 'ACTIVE')
            OR (v_year.status = 'ACTIVE' AND p_to = 'CLOSED');
    IF NOT v_valid THEN
        RAISE EXCEPTION 'Invalid academic year transition: % -> %', v_year.status, p_to
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_INVALID_LIFECYCLE_TRANSITION';
    END IF;

    IF p_to IN ('READY', 'ACTIVE') THEN
        SELECT count(*) INTO v_incomplete_semesters
          FROM semesters WHERE academic_year_id = p_year_id AND (start_date IS NULL OR end_date IS NULL);
        IF v_incomplete_semesters > 0 THEN
            RAISE EXCEPTION '% semester(s) still have no dates entered; the calendar cannot become % yet', v_incomplete_semesters, p_to
                USING ERRCODE = 'check_violation', HINT = 'CALENDAR_YEAR_NOT_READY';
        END IF;
    END IF;

    UPDATE academic_years SET status = p_to WHERE id = p_year_id RETURNING * INTO v_year;
    RETURN v_year;
END;
$$;

REVOKE ALL ON FUNCTION fn_transition_academic_year_status FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_transition_academic_year_status TO authenticated;

-- Same structural backstop at the semester's own scope: cannot ACTIVATE a
-- semester with no dates entered. (The full-taxonomy check stays owned by
-- the year-level transition above, not duplicated here.)
CREATE OR REPLACE FUNCTION fn_transition_semester_status(p_semester_id UUID, p_to semester_status)
RETURNS semesters
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sem semesters;
    v_valid BOOLEAN;
BEGIN
    IF NOT has_permission('calendar.manage') THEN
        RAISE EXCEPTION 'permission denied for calendar.manage' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_sem FROM semesters WHERE id = p_semester_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Semester % not found', p_semester_id USING ERRCODE = 'no_data_found';
    END IF;

    v_valid := (v_sem.status = 'UPCOMING' AND p_to = 'ACTIVE')
            OR (v_sem.status = 'ACTIVE' AND p_to = 'CLOSED');
    IF NOT v_valid THEN
        RAISE EXCEPTION 'Invalid semester transition: % -> %', v_sem.status, p_to
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_INVALID_LIFECYCLE_TRANSITION';
    END IF;

    IF p_to = 'ACTIVE' AND (v_sem.start_date IS NULL OR v_sem.end_date IS NULL) THEN
        RAISE EXCEPTION 'Semester % has no dates entered; it cannot become ACTIVE yet', v_sem.sem_order
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_YEAR_NOT_READY';
    END IF;

    UPDATE semesters SET status = p_to WHERE id = p_semester_id RETURNING * INTO v_sem;
    RETURN v_sem;
END;
$$;

REVOKE ALL ON FUNCTION fn_transition_semester_status FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_transition_semester_status TO authenticated;
