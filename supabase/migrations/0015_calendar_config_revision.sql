-- =============================================================================
-- Calendar Engine — Migration 0015: Real Configuration Revision
--
-- v2 zero-trust repair, Phase 1 (critical fixes #1-#4, #27, #31 from the
-- repair guide). Replaces the old "highest existing build + 1" build
-- counter — which is a build *sequence*, not a configuration *identity* —
-- with a real, content-tied revision on academic_years that every
-- authoritative fact mutation advances, whether that mutation comes from
-- ordinary editing or from fn_apply_calendar_correction(). Publication is
-- rewritten to check candidate.source_config_revision against the year's
-- *live* revision (read fresh, under lock) rather than against whatever the
-- previous CURRENT build happened to claim, and to independently verify the
-- candidate's structural completeness before promoting it — the database
-- stops trusting the caller for either fact.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The real revision counter.
--
-- Only bumped by a REAL change to an authoritative fact (guide: "a no-op
-- update should not artificially create an unnecessary revision... A real
-- change must"). Column-level REVOKE below means no authenticated caller can
-- set it directly in their own UPDATE's SET-list — only the triggers that
-- follow can move it, since a BEFORE-trigger assigning NEW.<col> is not
-- subject to the column privilege check on the *original* caller's
-- statement. This is the same technique Phase 2 will use to protect the
-- `status` lifecycle columns.
-- -----------------------------------------------------------------------------
ALTER TABLE academic_years ADD COLUMN calendar_config_revision INT NOT NULL DEFAULT 1;

-- A column-level REVOKE does NOT subtract from a pre-existing table-level
-- GRANT (Migration 0014 grants blanket UPDATE on academic_years to
-- authenticated) — Postgres privilege checks pass if EITHER the table-level
-- or the column-level grant allows it. The only way to actually protect one
-- column is to revoke the blanket table-level UPDATE entirely and re-grant
-- it column-by-column, omitting the protected one. `updated_at` is also
-- omitted since it's already trigger-managed (trg_academic_years_updated_at)
-- and never needs direct external write access; `status` remains grantable
-- here — its own protection is Phase 2's lifecycle-bypass fix, kept as a
-- separate migration so each phase's diff matches what it claims to do.
REVOKE UPDATE ON academic_years FROM authenticated;
GRANT UPDATE (year_ec, name, start_date, end_date, is_default_boundary, status) ON academic_years TO authenticated;

CREATE OR REPLACE FUNCTION fn_bump_calendar_config_revision(p_academic_year_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE academic_years
       SET calendar_config_revision = calendar_config_revision + 1
     WHERE id = p_academic_year_id;
END;
$$;

-- The year's OWN authoritative fields (its boundary). A BEFORE trigger so
-- the bump lands in the SAME statement/row version as the edit that caused
-- it — no second UPDATE, no recursion into itself.
CREATE OR REPLACE FUNCTION fn_bump_revision_on_year_boundary_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date THEN
        NEW.calendar_config_revision := OLD.calendar_config_revision + 1;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bump_revision_on_year_boundary_change
    BEFORE UPDATE ON academic_years
    FOR EACH ROW EXECUTE FUNCTION fn_bump_revision_on_year_boundary_change();

-- Every dependent fact table: any real INSERT/DELETE, or an UPDATE that
-- actually changes a column, bumps the parent year's revision. Semester/
-- year *lifecycle status* changes are deliberately excluded — status does
-- not change what the timeline builder computes, only editable facts do.

CREATE OR REPLACE FUNCTION fn_bump_revision_on_semester_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM fn_bump_calendar_config_revision(OLD.academic_year_id);
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date THEN
        PERFORM fn_bump_calendar_config_revision(NEW.academic_year_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bump_revision_on_semester_change
    AFTER INSERT OR UPDATE OR DELETE ON semesters
    FOR EACH ROW EXECUTE FUNCTION fn_bump_revision_on_semester_change();

CREATE OR REPLACE FUNCTION fn_bump_revision_on_holiday_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM fn_bump_calendar_config_revision(OLD.academic_year_id);
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT'
       OR NEW.date IS DISTINCT FROM OLD.date
       OR NEW.closes_school IS DISTINCT FROM OLD.closes_school
       OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
        PERFORM fn_bump_calendar_config_revision(NEW.academic_year_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bump_revision_on_holiday_change
    AFTER INSERT OR UPDATE OR DELETE ON holiday_occurrences
    FOR EACH ROW EXECUTE FUNCTION fn_bump_revision_on_holiday_change();

CREATE OR REPLACE FUNCTION fn_bump_revision_on_exam_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM fn_bump_calendar_config_revision(OLD.academic_year_id);
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date THEN
        PERFORM fn_bump_calendar_config_revision(NEW.academic_year_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bump_revision_on_exam_change
    AFTER INSERT OR UPDATE OR DELETE ON exam_instances
    FOR EACH ROW EXECUTE FUNCTION fn_bump_revision_on_exam_change();

CREATE OR REPLACE FUNCTION fn_bump_revision_on_student_return_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM fn_bump_calendar_config_revision(OLD.academic_year_id);
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' OR NEW.date IS DISTINCT FROM OLD.date THEN
        PERFORM fn_bump_calendar_config_revision(NEW.academic_year_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bump_revision_on_student_return_change
    AFTER INSERT OR UPDATE OR DELETE ON student_return_days
    FOR EACH ROW EXECUTE FUNCTION fn_bump_revision_on_student_return_change();

-- Dependencies aren't consumed by the build pipeline until Phase 3, but the
-- revision contract must already be correct for them — an active dependency
-- rule is exactly as "authoritative" as a manually-entered date the moment
-- Phase 3 wires it in, and retrofitting this trigger later would silently
-- under-count revisions for any dependency edited between now and then.
CREATE OR REPLACE FUNCTION fn_bump_revision_on_dependency_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM fn_bump_calendar_config_revision(OLD.academic_year_id);
        RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT'
       OR NEW.active IS DISTINCT FROM OLD.active
       OR NEW.offset_days IS DISTINCT FROM OLD.offset_days
       OR NEW.anchor_kind IS DISTINCT FROM OLD.anchor_kind
       OR NEW.anchor_semester_order IS DISTINCT FROM OLD.anchor_semester_order
       OR NEW.anchor_holiday_type_key IS DISTINCT FROM OLD.anchor_holiday_type_key
       OR NEW.anchor_exam_type_key IS DISTINCT FROM OLD.anchor_exam_type_key
       OR NEW.dependent_kind IS DISTINCT FROM OLD.dependent_kind
       OR NEW.dependent_semester_order IS DISTINCT FROM OLD.dependent_semester_order
       OR NEW.dependent_holiday_type_key IS DISTINCT FROM OLD.dependent_holiday_type_key
       OR NEW.dependent_exam_type_key IS DISTINCT FROM OLD.dependent_exam_type_key THEN
        PERFORM fn_bump_calendar_config_revision(NEW.academic_year_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bump_revision_on_dependency_change
    AFTER INSERT OR UPDATE OR DELETE ON calendar_dependencies
    FOR EACH ROW EXECUTE FUNCTION fn_bump_revision_on_dependency_change();

-- -----------------------------------------------------------------------------
-- 2. calendar_timeline_builds: config_version renamed to what it actually
-- is now — the real revision the candidate was built from, not a build
-- counter. Ordering still works (revision is monotonic), but it's no longer
-- possible for it to mean two different things depending on whether a
-- second build happened to exist yet.
-- -----------------------------------------------------------------------------
ALTER TABLE calendar_timeline_builds RENAME COLUMN config_version TO source_config_revision;
DROP INDEX IF EXISTS idx_timeline_builds_year_version;
CREATE INDEX idx_timeline_builds_year_revision ON calendar_timeline_builds(academic_year_id, source_config_revision DESC);

COMMENT ON COLUMN calendar_timeline_builds.source_config_revision IS
    'The academic_years.calendar_config_revision that was live at the moment '
    'this candidate''s configuration snapshot was read. Publication compares '
    'this against the year''s LIVE revision (not the previous build''s), so a '
    'candidate that has gone stale is caught even if no newer build was ever '
    'made.';

-- -----------------------------------------------------------------------------
-- 3. The coherent snapshot (fix #2). A torn read is one where two of the
-- five underlying queries observe different points in time because a
-- mutation landed between them. This function detects that by capturing
-- the revision before and after assembling the snapshot and retrying (a
-- bounded number of times) if it moved — the standard optimistic-read
-- pattern for exactly this problem. SECURITY INVOKER (the default — no
-- SECURITY DEFINER here) is deliberate: every underlying table already has
-- an identical calendar.view SELECT policy, so RLS enforces authorization
-- exactly as it did through the five separate queries this replaces; this
-- function does not need, and should not have, elevated rights.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_load_calendar_config_snapshot(p_academic_year_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_rev_before INT;
    v_rev_after INT;
    v_snapshot JSONB;
    v_attempt INT := 0;
BEGIN
    LOOP
        v_attempt := v_attempt + 1;

        SELECT calendar_config_revision INTO v_rev_before
          FROM academic_years WHERE id = p_academic_year_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Academic year % not found', p_academic_year_id USING ERRCODE = 'no_data_found';
        END IF;

        SELECT jsonb_build_object(
            'academicYear', (SELECT to_jsonb(y) FROM academic_years y WHERE y.id = p_academic_year_id),
            'semesters', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sem_order), '[]'::jsonb)
                            FROM semesters s WHERE s.academic_year_id = p_academic_year_id),
            'holidayOccurrences', (SELECT coalesce(jsonb_agg(to_jsonb(h)), '[]'::jsonb)
                            FROM holiday_occurrences h WHERE h.academic_year_id = p_academic_year_id),
            'examInstances', (SELECT coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
                            FROM exam_instances e WHERE e.academic_year_id = p_academic_year_id),
            'studentReturn', (SELECT to_jsonb(sr) FROM student_return_days sr WHERE sr.academic_year_id = p_academic_year_id),
            'dependencies', (SELECT coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
                            FROM calendar_dependencies d WHERE d.academic_year_id = p_academic_year_id AND d.active)
        ) INTO v_snapshot;

        SELECT calendar_config_revision INTO v_rev_after
          FROM academic_years WHERE id = p_academic_year_id;

        EXIT WHEN v_rev_before = v_rev_after OR v_attempt >= 5;
    END LOOP;

    IF v_rev_before <> v_rev_after THEN
        RAISE EXCEPTION 'Configuration kept changing while reading a consistent snapshot (revision % -> % after % attempts)',
            v_rev_before, v_rev_after, v_attempt
            USING ERRCODE = 'serialization_failure', HINT = 'CALENDAR_CONFIG_SNAPSHOT_TORN';
    END IF;

    RETURN v_snapshot || jsonb_build_object('configRevision', v_rev_before);
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. timeline_day <-> build year-match integrity (fix #31). Enforced as a
-- trigger, not just RLS, on purpose (guide: "Do not rely only on
-- application inserts") — this fires regardless of which role performs the
-- write, including service_role.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_check_timeline_day_year_matches_build()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_build_year UUID;
BEGIN
    SELECT academic_year_id INTO v_build_year FROM calendar_timeline_builds WHERE id = NEW.build_id;
    IF v_build_year IS NULL THEN
        RAISE EXCEPTION 'timeline day references a build that does not exist (build_id=%)', NEW.build_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_build_year <> NEW.academic_year_id THEN
        RAISE EXCEPTION 'timeline day academic_year_id (%) does not match its build''s academic_year_id (%)',
            NEW.academic_year_id, v_build_year
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_TIMELINE_DAY_YEAR_MISMATCH';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_timeline_day_year_matches_build
    BEFORE INSERT OR UPDATE ON calendar_timeline_days
    FOR EACH ROW EXECUTE FUNCTION fn_check_timeline_day_year_matches_build();

-- -----------------------------------------------------------------------------
-- 5. fn_publish_calendar_timeline — rewritten (fixes #3, #4, #27).
--
-- What changed vs. Migration 0013's version:
--   a) Staleness is now `candidate.source_config_revision <> year's LIVE
--      revision`, read fresh under the same row lock — not a comparison
--      against whatever the previous CURRENT build claims. This is what
--      catches "one build, facts changed, no second build ever happened,
--      try to publish the first one anyway" — the old version-vs-version
--      check could not see this because nothing else had a higher number.
--   b) Structural completeness is independently verified here: exact day
--      count, first date, last date, and (via the UNIQUE(build_id,date)
--      constraint already on the table) uniqueness — count + min + max
--      matching the year's span mathematically implies no gaps, given
--      dates are already guaranteed unique. Every timeline_days row is
--      also checked to actually belong to this build's year.
--   c) SET search_path = public, pg_temp added — it was missing here and
--      on every other SECURITY DEFINER function below.
--
-- Documented, deliberate scope boundary: this verifies STRUCTURAL
-- completeness (right shape, right count, right span, right year), not
-- that each day's semantic content (holiday closures, teaching-day flags,
-- etc.) was correctly derived from the authoritative facts. Re-deriving
-- the full domain logic in SQL would duplicate — and risk diverging from —
-- the TypeScript domain engine that already owns it. A caller who already
-- holds calendar.build_timeline and deliberately fabricates a structurally
-- valid but semantically wrong candidate is a trusted-insider-abuse
-- scenario, not an unauthorized-access one; closing it fully would mean
-- moving candidate *generation*, not just validation, behind this
-- function, which is a larger change than this repair pass takes on.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_publish_calendar_timeline(p_build_id UUID)
RETURNS calendar_timeline_builds
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_build calendar_timeline_builds;
    v_current calendar_timeline_builds;
    v_year academic_years;
    v_expected_days INT;
    v_actual_days INT;
    v_min_date DATE;
    v_max_date DATE;
    v_mismatched_year_rows INT;
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

    -- Lock the year row: this is both the concurrency boundary (two
    -- publishes for the same year can never interleave) AND, now, the
    -- source of truth for staleness — we read calendar_config_revision
    -- from this same locked row, not from a sibling build.
    SELECT * INTO v_year FROM academic_years WHERE id = v_build.academic_year_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Academic year % not found', v_build.academic_year_id USING ERRCODE = 'no_data_found';
    END IF;

    IF v_build.source_config_revision <> v_year.calendar_config_revision THEN
        UPDATE calendar_timeline_builds
           SET status = 'SUPERSEDED',
               failure_reason = format('Stale: year is now at revision %s; candidate was built from revision %s',
                                        v_year.calendar_config_revision, v_build.source_config_revision)
         WHERE id = v_build.id;
        RAISE EXCEPTION 'Stale build: the academic year is now at configuration revision % (candidate was built from revision %)',
            v_year.calendar_config_revision, v_build.source_config_revision
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_STALE_BUILD';
    END IF;

    -- Structural verification (fix #3). Every check below is against the
    -- database's own row counts, never against anything the caller merely
    -- asserted.
    v_expected_days := (v_year.end_date - v_year.start_date) + 1;

    SELECT count(*), min(date), max(date)
      INTO v_actual_days, v_min_date, v_max_date
      FROM calendar_timeline_days WHERE build_id = v_build.id;

    SELECT count(*) INTO v_mismatched_year_rows
      FROM calendar_timeline_days WHERE build_id = v_build.id AND academic_year_id <> v_build.academic_year_id;

    IF v_mismatched_year_rows > 0 THEN
        UPDATE calendar_timeline_builds SET status = 'FAILED',
               failure_reason = format('%s timeline day row(s) reference a different academic_year_id than this build', v_mismatched_year_rows)
         WHERE id = v_build.id;
        RAISE EXCEPTION 'Candidate has % timeline day row(s) whose academic_year_id does not match the build''s year',
            v_mismatched_year_rows
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_TIMELINE_DAY_YEAR_MISMATCH';
    END IF;

    IF v_actual_days IS DISTINCT FROM v_expected_days THEN
        UPDATE calendar_timeline_builds SET status = 'FAILED',
               failure_reason = format('Expected %s daily rows (year span), found %s', v_expected_days, coalesce(v_actual_days, 0))
         WHERE id = v_build.id;
        RAISE EXCEPTION 'Candidate is incomplete: expected % daily rows for the year''s span, found %',
            v_expected_days, coalesce(v_actual_days, 0)
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_CANDIDATE_INCOMPLETE';
    END IF;

    IF v_min_date IS DISTINCT FROM v_year.start_date OR v_max_date IS DISTINCT FROM v_year.end_date THEN
        UPDATE calendar_timeline_builds SET status = 'FAILED',
               failure_reason = format('Candidate spans %s..%s, year requires %s..%s', v_min_date, v_max_date, v_year.start_date, v_year.end_date)
         WHERE id = v_build.id;
        RAISE EXCEPTION 'Candidate does not span the full academic year: got %..%, need %..%',
            v_min_date, v_max_date, v_year.start_date, v_year.end_date
            USING ERRCODE = 'check_violation', HINT = 'CALENDAR_CANDIDATE_INCOMPLETE';
    END IF;
    -- Note: v_actual_days = v_expected_days, min = start_date, max =
    -- end_date, and (build_id, date) is UNIQUE on the table — together
    -- these mathematically guarantee the full contiguous date range is
    -- present exactly once each, with no separate gap/duplicate scan
    -- needed.

    SELECT * INTO v_current FROM calendar_timeline_builds
     WHERE academic_year_id = v_build.academic_year_id AND status = 'CURRENT'
     FOR UPDATE;

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
-- 6. search_path hardening for the remaining SECURITY DEFINER functions
-- (fix #27) — lightweight ALTER, no body changes, since their logic is
-- otherwise untouched in this phase (lifecycle bypass closure is Phase 2).
-- -----------------------------------------------------------------------------
ALTER FUNCTION fn_record_failed_build(UUID, TEXT) SET search_path = public, pg_temp;
ALTER FUNCTION fn_transition_academic_year_status(UUID, academic_year_status) SET search_path = public, pg_temp;
ALTER FUNCTION fn_transition_semester_status(UUID, semester_status) SET search_path = public, pg_temp;
ALTER FUNCTION fn_apply_calendar_correction(UUID, calendar_fact_kind, SMALLINT, holiday_type_key, exam_type_key, DATE, TEXT)
    SET search_path = public, pg_temp;
