-- =============================================================================
-- Calendar Engine — Migration 0013: RPC Functions
--
-- Every function here is SECURITY DEFINER, following the exact pattern
-- 06_Backend_Architecture.md §8 establishes for controlled elevated writes:
-- each function performs its OWN has_permission() check internally rather
-- than relying solely on the calling row's RLS policy, and uses explicit
-- row locking (`FOR UPDATE`) to make the operation safe under concurrency.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- fn_publish_calendar_timeline — mission §29-32.
-- Atomically promotes a CANDIDATE build to CURRENT, or rejects it as stale
-- if a newer configuration has already been published (mission §30's "A
-- begins rebuilding, B is saved and begins rebuilding, B finishes first,
-- A must not overwrite B" scenario) — the exact rule rebuild.ts's
-- attemptPublish() checks in pure TypeScript, enforced here as the actual
-- atomic boundary.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_publish_calendar_timeline(p_build_id UUID)
RETURNS calendar_timeline_builds
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_build calendar_timeline_builds;
    v_current calendar_timeline_builds;
BEGIN
    IF NOT has_permission('calendar.build_timeline') THEN
        RAISE EXCEPTION 'permission denied for calendar.build_timeline' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_build FROM calendar_timeline_builds WHERE id = p_build_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Build % not found', p_build_id USING ERRCODE = 'no_data_found';
    END IF;
    IF v_build.status <> 'CANDIDATE' THEN
        RAISE EXCEPTION 'Build % is not a CANDIDATE (status=%)', p_build_id, v_build.status
            USING ERRCODE = 'check_violation';
    END IF;

    -- Lock the year row so two concurrent publish attempts for the same
    -- year can never interleave their read-then-write of "what's current."
    PERFORM 1 FROM academic_years WHERE id = v_build.academic_year_id FOR UPDATE;

    SELECT * INTO v_current FROM calendar_timeline_builds
     WHERE academic_year_id = v_build.academic_year_id AND status = 'CURRENT'
     FOR UPDATE;

    IF FOUND AND v_current.config_version >= v_build.config_version THEN
        UPDATE calendar_timeline_builds
           SET status = 'SUPERSEDED',
               failure_reason = format('Stale: current version %s >= candidate version %s', v_current.config_version, v_build.config_version)
         WHERE id = v_build.id;
        RAISE EXCEPTION 'Stale build: configuration version % is already current (candidate was version %)',
            v_current.config_version, v_build.config_version
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_STALE_BUILD';
    END IF;

    IF FOUND THEN
        UPDATE calendar_timeline_builds SET status = 'SUPERSEDED' WHERE id = v_current.id;
    END IF;

    UPDATE calendar_timeline_builds
       SET status = 'CURRENT', published_at = NOW()
     WHERE id = v_build.id
     RETURNING * INTO v_build;

    RETURN v_build;
END;
$$;

REVOKE ALL ON FUNCTION fn_publish_calendar_timeline FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_publish_calendar_timeline TO authenticated;

-- -----------------------------------------------------------------------------
-- fn_record_failed_build — mission §29: "If a rebuild fails ... record the
-- failed rebuild, surface the failure, do not pretend the new configuration
-- became active." The CURRENT build, if any, is left completely untouched.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_record_failed_build(p_build_id UUID, p_reason TEXT)
RETURNS calendar_timeline_builds
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_build calendar_timeline_builds;
BEGIN
    IF NOT has_permission('calendar.build_timeline') THEN
        RAISE EXCEPTION 'permission denied for calendar.build_timeline' USING ERRCODE = '42501';
    END IF;

    UPDATE calendar_timeline_builds
       SET status = 'FAILED', failure_reason = p_reason
     WHERE id = p_build_id AND status = 'CANDIDATE'
     RETURNING * INTO v_build;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Build % not found or not a CANDIDATE', p_build_id USING ERRCODE = 'no_data_found';
    END IF;
    RETURN v_build;
END;
$$;

REVOKE ALL ON FUNCTION fn_record_failed_build FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_record_failed_build TO authenticated;

-- -----------------------------------------------------------------------------
-- fn_transition_academic_year_status — mission §5's
-- PREPARING -> READY -> ACTIVE -> CLOSED, one legal step at a time.
-- "Exactly one ACTIVE year" is enforced separately and declaratively by
-- idx_academic_years_one_active (Migration 0002); this function does not
-- duplicate that check, it just lets the resulting unique_violation surface.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_transition_academic_year_status(p_year_id UUID, p_to academic_year_status)
RETURNS academic_years
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_year academic_years;
    v_valid BOOLEAN;
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

    UPDATE academic_years SET status = p_to WHERE id = p_year_id RETURNING * INTO v_year;
    RETURN v_year;
END;
$$;

REVOKE ALL ON FUNCTION fn_transition_academic_year_status FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_transition_academic_year_status TO authenticated;

-- -----------------------------------------------------------------------------
-- fn_transition_semester_status — mission §6's UPCOMING -> ACTIVE -> CLOSED.
-- No unlockSemester() exists anywhere in this schema, on purpose (mission
-- §36 / LEGACY_REMOVAL.md).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_transition_semester_status(p_semester_id UUID, p_to semester_status)
RETURNS semesters
LANGUAGE plpgsql SECURITY DEFINER AS $$
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

    UPDATE semesters SET status = p_to WHERE id = p_semester_id RETURNING * INTO v_sem;
    RETURN v_sem;
END;
$$;

REVOKE ALL ON FUNCTION fn_transition_semester_status FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_transition_semester_status TO authenticated;

-- -----------------------------------------------------------------------------
-- fn_apply_calendar_correction — mission §37. The ONLY path that can ever
-- change a date fact belonging to a CLOSED year or semester. Requires the
-- stronger calendar.correct_history permission, records the correction
-- immutably, and updates the live fact in the same transaction.
--
-- What this function deliberately does NOT do: rebuild the timeline. A
-- correction changes one fact; producing a new CURRENT timeline that
-- reflects it is a separate, explicit next step (generate a candidate,
-- then fn_publish_calendar_timeline) — corrections and rebuilds are kept
-- as two separate, individually-inspectable operations rather than one
-- opaque one, matching mission §29's safe-rebuild model.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_apply_calendar_correction(
    p_academic_year_id UUID,
    p_fact_kind calendar_fact_kind,
    p_fact_semester_order SMALLINT,
    p_fact_holiday_type_key holiday_type_key,
    p_fact_exam_type_key exam_type_key,
    p_corrected_value DATE,
    p_reason TEXT
) RETURNS calendar_corrections
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_year academic_years;
    v_semester semesters;
    v_original DATE;
    v_correction calendar_corrections;
    v_actor UUID;
BEGIN
    IF NOT has_permission('calendar.correct_history') THEN
        RAISE EXCEPTION 'permission denied for calendar.correct_history' USING ERRCODE = '42501';
    END IF;

    SELECT id INTO v_actor FROM users WHERE supabase_uid = auth.uid();

    SELECT * INTO v_year FROM academic_years WHERE id = p_academic_year_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Academic year % not found', p_academic_year_id USING ERRCODE = 'no_data_found';
    END IF;

    IF p_fact_kind IN ('SEMESTER_START', 'SEMESTER_END') THEN
        SELECT * INTO v_semester FROM semesters
         WHERE academic_year_id = p_academic_year_id AND sem_order = p_fact_semester_order FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Semester % not found for year %', p_fact_semester_order, p_academic_year_id
                USING ERRCODE = 'no_data_found';
        END IF;
        IF v_semester.status <> 'CLOSED' THEN
            RAISE EXCEPTION 'Semester % is not CLOSED; use ordinary editing instead', p_fact_semester_order
                USING ERRCODE = 'check_violation', HINT = 'CALENDAR_CORRECTION_REQUIRES_CLOSED_SCOPE';
        END IF;
    ELSIF v_year.status <> 'CLOSED' THEN
        RAISE EXCEPTION 'Academic year is not CLOSED; use ordinary editing instead'
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_CORRECTION_REQUIRES_CLOSED_SCOPE';
    END IF;

    CASE p_fact_kind
        WHEN 'SEMESTER_START' THEN
            v_original := v_semester.start_date;
            UPDATE semesters SET start_date = p_corrected_value WHERE id = v_semester.id;
        WHEN 'SEMESTER_END' THEN
            v_original := v_semester.end_date;
            UPDATE semesters SET end_date = p_corrected_value WHERE id = v_semester.id;
        WHEN 'STUDENT_RETURN' THEN
            SELECT date INTO v_original FROM student_return_days WHERE academic_year_id = p_academic_year_id;
            UPDATE student_return_days SET date = p_corrected_value WHERE academic_year_id = p_academic_year_id;
        WHEN 'HOLIDAY_OCCURRENCE' THEN
            SELECT date INTO v_original FROM holiday_occurrences
             WHERE academic_year_id = p_academic_year_id AND holiday_type_key = p_fact_holiday_type_key;
            UPDATE holiday_occurrences SET date = p_corrected_value
             WHERE academic_year_id = p_academic_year_id AND holiday_type_key = p_fact_holiday_type_key;
        WHEN 'EXAM_START' THEN
            SELECT start_date INTO v_original FROM exam_instances
             WHERE academic_year_id = p_academic_year_id AND exam_type_key = p_fact_exam_type_key;
            UPDATE exam_instances SET start_date = p_corrected_value
             WHERE academic_year_id = p_academic_year_id AND exam_type_key = p_fact_exam_type_key;
        WHEN 'EXAM_END' THEN
            SELECT end_date INTO v_original FROM exam_instances
             WHERE academic_year_id = p_academic_year_id AND exam_type_key = p_fact_exam_type_key;
            UPDATE exam_instances SET end_date = p_corrected_value
             WHERE academic_year_id = p_academic_year_id AND exam_type_key = p_fact_exam_type_key;
        WHEN 'ACADEMIC_YEAR_START' THEN
            v_original := v_year.start_date;
            UPDATE academic_years SET start_date = p_corrected_value WHERE id = p_academic_year_id;
        WHEN 'ACADEMIC_YEAR_END' THEN
            v_original := v_year.end_date;
            UPDATE academic_years SET end_date = p_corrected_value WHERE id = p_academic_year_id;
        ELSE
            RAISE EXCEPTION 'Correction not supported for fact kind %', p_fact_kind USING ERRCODE = 'check_violation';
    END CASE;

    IF v_original IS NULL THEN
        RAISE EXCEPTION 'Could not resolve the original value for %/% — nothing to correct',
            p_fact_kind, p_academic_year_id USING ERRCODE = 'no_data_found';
    END IF;

    INSERT INTO calendar_corrections (
        academic_year_id, fact_kind, fact_semester_order, fact_holiday_type_key, fact_exam_type_key,
        original_value, corrected_value, reason, performed_by
    ) VALUES (
        p_academic_year_id, p_fact_kind, p_fact_semester_order, p_fact_holiday_type_key, p_fact_exam_type_key,
        v_original, p_corrected_value, p_reason, v_actor
    ) RETURNING * INTO v_correction;

    RETURN v_correction;
END;
$$;

REVOKE ALL ON FUNCTION fn_apply_calendar_correction FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_apply_calendar_correction TO authenticated;
