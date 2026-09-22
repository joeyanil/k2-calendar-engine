-- =============================================================================
-- LOCAL-VERIFICATION-ONLY — NOT part of any deliverable.
--
-- Adapted from supabase/dev-fixtures/02_functional_verification.sql to run
-- against the new standalone bootstrap schema instead of
-- 01_base_k2_schema_stub.sql. Run after applying, in order:
--   dev-fixtures/00_auth_stub.sql
--   standalone/local-verification/00_auth_users_test_stub.sql
--   standalone/0000_standalone_bootstrap.sql
--   migrations/0001..0014
--
-- TESTS 1-9 reproduce the original suite verbatim in intent (same
-- assertions: RLS blocks the unpermissioned, the movable-holiday hard
-- rule, both exam hard stops, circular-dependency rejection, the exact
-- stale-build race from mission section 30, CLOSED-year protection, and
-- the formal-correction RPC) — proving the calendar engine's own behavior
-- is unchanged under the new real base schema.
--
-- TESTS A-D are new, specific to what actually changed in this schema:
--   A. a suspended user holding the Admin role is still blocked by
--      has_permission() at the database layer (defense in depth);
--   B. the exact row-shape `withAuth()` reads (id, user_type, status) is
--      reachable through RLS for the correct caller, for both an ACTIVE
--      and a SUSPENDED account, and returns zero rows for an unlinked
--      Supabase Auth identity;
--   C. `resolveEffectivePermissions()`'s own two raw queries (against
--      user_roles/roles/role_permissions/permissions and against
--      user_permissions/permissions directly) — not just has_permission()
--      — actually return the right keys through RLS, for both the
--      role-granted and the direct-grant path;
--   D. a user with ONLY calendar.view (no calendar.manage) can read but
--      not write academic_years, proving the RLS grant transfers
--      correctly onto a real, non-role-based permission is caught too.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id) VALUES
    ('11111111-1111-1111-1111-111111111111'),  -- admin, ACTIVE, role-granted
    ('22222222-2222-2222-2222-222222222222'),  -- no permissions at all
    ('33333333-3333-3333-3333-333333333333'),  -- admin role, but SUSPENDED
    ('44444444-4444-4444-4444-444444444444');  -- calendar.view only, direct grant

DO $$
DECLARE
    v_role_id UUID;
    v_admin_id UUID;
    v_suspended_id UUID;
    v_viewer_id UUID;
BEGIN
    INSERT INTO roles (name) VALUES ('Calendar Test Admin') RETURNING id INTO v_role_id;
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT v_role_id, id FROM permissions WHERE resource = 'calendar';

    INSERT INTO users (id, supabase_uid, full_name, user_type, status)
    VALUES ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Test Admin', 'ADMIN', 'ACTIVE')
    RETURNING id INTO v_admin_id;
    INSERT INTO user_roles (user_id, role_id) VALUES (v_admin_id, v_role_id);

    INSERT INTO users (id, supabase_uid, full_name, user_type)
    VALUES ('00000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'No Permissions', 'TEACHER');

    INSERT INTO users (id, supabase_uid, full_name, user_type, status)
    VALUES ('00000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'Suspended Admin', 'ADMIN', 'SUSPENDED')
    RETURNING id INTO v_suspended_id;
    INSERT INTO user_roles (user_id, role_id) VALUES (v_suspended_id, v_role_id);

    INSERT INTO users (id, supabase_uid, full_name, user_type)
    VALUES ('00000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444', 'Viewer Only', 'TEACHER')
    RETURNING id INTO v_viewer_id;
    INSERT INTO user_permissions (user_id, permission_id)
    SELECT v_viewer_id, id FROM permissions WHERE resource = 'calendar' AND action = 'view';
END $$;

-- =============================================================================
-- TEST 1: RLS blocks a user with no calendar.view permission from SELECTing.
-- =============================================================================
SET ROLE authenticated;
SELECT set_config('app.current_uid', '22222222-2222-2222-2222-222222222222', false);

DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT count(*) INTO v_count FROM academic_years;
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'TEST 1 FAILED: no-permission user could see % academic_years rows', v_count;
    END IF;
    RAISE NOTICE 'TEST 1 PASSED: no-permission user sees zero academic_years rows via RLS';
END $$;

RESET ROLE;
RESET app.current_uid;

-- =============================================================================
-- TEST 2: the admin user CAN create an academic year, semesters, holidays.
-- =============================================================================
SET ROLE authenticated;
SELECT set_config('app.current_uid', '11111111-1111-1111-1111-111111111111', false);

INSERT INTO academic_years (id, year_ec, name, start_date, end_date, status, created_by)
VALUES ('a0000000-0000-0000-0000-000000000019', 2019, '2019 E.C.', '2026-09-15', '2027-07-07', 'PREPARING',
        '00000000-0000-0000-0000-000000000001');

DO $$ BEGIN
  IF (SELECT count(*) FROM academic_years WHERE year_ec = 2019) = 1 THEN
    RAISE NOTICE 'TEST 2 PASSED: admin created the 2019 E.C. academic year';
  ELSE
    RAISE EXCEPTION 'TEST 2 FAILED';
  END IF;
END $$;

-- Semesters are now auto-created by Migration 0016's trigger, atomically
-- with the year — set their real dates and activate semester 1 via the
-- transition RPC (ordinary UPDATE can no longer touch `status` directly).
UPDATE semesters SET start_date = '2026-09-15', end_date = '2026-12-29'
 WHERE academic_year_id = 'a0000000-0000-0000-0000-000000000019' AND sem_order = 1;
UPDATE semesters SET start_date = '2027-01-28', end_date = '2027-07-07'
 WHERE academic_year_id = 'a0000000-0000-0000-0000-000000000019' AND sem_order = 2;
SELECT fn_transition_semester_status(
    (SELECT id FROM semesters WHERE academic_year_id = 'a0000000-0000-0000-0000-000000000019' AND sem_order = 1),
    'ACTIVE');

INSERT INTO holiday_occurrences (academic_year_id, holiday_type_key, date, source)
VALUES ('a0000000-0000-0000-0000-000000000019', 'GENNA', '2027-01-07', 'AUTO_PROPOSED');

DO $$ BEGIN RAISE NOTICE 'TEST 2b PASSED: semesters dated + semester 1 activated + fixed holiday created'; END $$;

-- =============================================================================
-- TEST 3: a movable holiday MUST be ADMIN_ENTERED — AUTO_PROPOSED is rejected.
-- =============================================================================
DO $$
BEGIN
    BEGIN
        INSERT INTO holiday_occurrences (academic_year_id, holiday_type_key, date, source)
        VALUES ('a0000000-0000-0000-0000-000000000019', 'FASIKA', '2027-05-02', 'AUTO_PROPOSED');
        RAISE EXCEPTION 'TEST 3 FAILED: movable holiday accepted with source=AUTO_PROPOSED';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'TEST 3 PASSED: movable holiday with AUTO_PROPOSED source rejected: %', SQLERRM;
    END;
END $$;

INSERT INTO holiday_occurrences (academic_year_id, holiday_type_key, date, source)
VALUES ('a0000000-0000-0000-0000-000000000019', 'FASIKA', '2027-05-02', 'ADMIN_ENTERED');
DO $$ BEGIN RAISE NOTICE 'TEST 3b PASSED: movable holiday with ADMIN_ENTERED source accepted'; END $$;

-- =============================================================================
-- TEST 4: exam hard stops — weekend and closing-holiday overlap rejected.
-- =============================================================================
DO $$
BEGIN
    BEGIN
        INSERT INTO exam_instances (academic_year_id, exam_type_key, start_date, end_date)
        VALUES ('a0000000-0000-0000-0000-000000000019', 'S1_FINAL', '2026-12-14', '2026-12-19');
        RAISE EXCEPTION 'TEST 4 FAILED: exam spanning a weekend was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'TEST 4 PASSED: exam spanning a weekend rejected: %', SQLERRM;
    END;

    BEGIN
        INSERT INTO exam_instances (academic_year_id, exam_type_key, start_date, end_date)
        VALUES ('a0000000-0000-0000-0000-000000000019', 'S1_FINAL', '2027-01-05', '2027-01-07');
        RAISE EXCEPTION 'TEST 4c FAILED: exam overlapping a closing holiday was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'TEST 4c PASSED: exam overlapping Genna rejected: %', SQLERRM;
    END;
END $$;

INSERT INTO exam_instances (academic_year_id, exam_type_key, start_date, end_date)
VALUES ('a0000000-0000-0000-0000-000000000019', 'S1_FINAL', '2026-12-14', '2026-12-18');
DO $$ BEGIN RAISE NOTICE 'TEST 4b PASSED: a clean Mon-Fri exam window was accepted'; END $$;

-- =============================================================================
-- TEST 5: circular dependency rejected at the database layer.
-- =============================================================================
INSERT INTO calendar_dependencies (academic_year_id, anchor_kind, anchor_semester_order, dependent_kind, offset_days, created_by)
VALUES ('a0000000-0000-0000-0000-000000000019', 'SEMESTER_START', 1, 'STUDENT_RETURN', -1, '00000000-0000-0000-0000-000000000001');

DO $$
BEGIN
    BEGIN
        INSERT INTO calendar_dependencies (academic_year_id, anchor_kind, dependent_kind, dependent_semester_order, offset_days, created_by)
        VALUES ('a0000000-0000-0000-0000-000000000019', 'STUDENT_RETURN', 'SEMESTER_START', 1, 1, '00000000-0000-0000-0000-000000000001');
        RAISE EXCEPTION 'TEST 5 FAILED: circular dependency was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'TEST 5 PASSED: circular dependency rejected: %', SQLERRM;
    END;
END $$;

-- =============================================================================
-- TEST 6/7: fn_publish_calendar_timeline — happy path + staleness guard.
--
-- Same update as 02_functional_verification.sql: Migration 0015 replaced
-- the build-counter model with a real calendar_config_revision, so
-- source_config_revision is captured live rather than hardcoded, and every
-- candidate needs a structurally complete day-set now that publish
-- independently verifies exact day count and exact span.
-- =============================================================================
SELECT calendar_config_revision FROM academic_years
 WHERE id = 'a0000000-0000-0000-0000-000000000019' \gset rev1_

INSERT INTO calendar_timeline_builds (id, academic_year_id, status, source_config_revision, config_hash, created_by)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000019', 'CANDIDATE',
        :rev1_calendar_config_revision, 'hash1', '00000000-0000-0000-0000-000000000001');
INSERT INTO calendar_timeline_days (build_id, academic_year_id, date, ethiopian_year, ethiopian_month, ethiopian_day,
        weekday, is_weekend, school_open, teaching_day, attendance_available, grade12_attendance_available)
SELECT 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000019', d::date, 2019, 1, 1,
        extract(dow from d)::int, extract(dow from d) IN (0,6), true, true, true, true
FROM generate_series('2026-09-15'::date, '2027-07-07'::date, '1 day') d;
SELECT fn_publish_calendar_timeline('b0000000-0000-0000-0000-000000000001');

DO $$ BEGIN
  IF (SELECT status FROM calendar_timeline_builds WHERE id = 'b0000000-0000-0000-0000-000000000001') = 'CURRENT' THEN
    RAISE NOTICE 'TEST 6 PASSED: revision-1 build published as CURRENT';
  ELSE
    RAISE EXCEPTION 'TEST 6 FAILED';
  END IF;
END $$;

UPDATE semesters SET end_date = '2026-12-30'
 WHERE academic_year_id = 'a0000000-0000-0000-0000-000000000019' AND sem_order = 1;

SELECT calendar_config_revision FROM academic_years
 WHERE id = 'a0000000-0000-0000-0000-000000000019' \gset rev2_

INSERT INTO calendar_timeline_builds (id, academic_year_id, status, source_config_revision, config_hash, created_by)
VALUES ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000019', 'CANDIDATE',
        :rev2_calendar_config_revision, 'hash2', '00000000-0000-0000-0000-000000000001');
INSERT INTO calendar_timeline_days (build_id, academic_year_id, date, ethiopian_year, ethiopian_month, ethiopian_day,
        weekday, is_weekend, school_open, teaching_day, attendance_available, grade12_attendance_available)
SELECT 'b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000019', d::date, 2019, 1, 1,
        extract(dow from d)::int, extract(dow from d) IN (0,6), true, true, true, true
FROM generate_series('2026-09-15'::date, '2027-07-07'::date, '1 day') d;
SELECT fn_publish_calendar_timeline('b0000000-0000-0000-0000-000000000002');

DO $$ BEGIN
  IF (SELECT status FROM calendar_timeline_builds WHERE id = 'b0000000-0000-0000-0000-000000000002') = 'CURRENT'
     AND (SELECT status FROM calendar_timeline_builds WHERE id = 'b0000000-0000-0000-0000-000000000001') = 'SUPERSEDED' THEN
    RAISE NOTICE 'TEST 6b PASSED: revision-2 build is now CURRENT, revision-1 build correctly SUPERSEDED';
  ELSE
    RAISE EXCEPTION 'TEST 6b FAILED';
  END IF;
END $$;

INSERT INTO calendar_timeline_builds (id, academic_year_id, status, source_config_revision, config_hash, created_by)
VALUES ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000019', 'CANDIDATE',
        :rev1_calendar_config_revision, 'hash1-late', '00000000-0000-0000-0000-000000000001');
INSERT INTO calendar_timeline_days (build_id, academic_year_id, date, ethiopian_year, ethiopian_month, ethiopian_day,
        weekday, is_weekend, school_open, teaching_day, attendance_available, grade12_attendance_available)
SELECT 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000019', d::date, 2019, 1, 1,
        extract(dow from d)::int, extract(dow from d) IN (0,6), true, true, true, true
FROM generate_series('2026-09-15'::date, '2027-07-07'::date, '1 day') d;

DO $$
BEGIN
    BEGIN
        PERFORM fn_publish_calendar_timeline('b0000000-0000-0000-0000-000000000003');
        RAISE EXCEPTION 'TEST 7 FAILED: stale build (old revision) was published over the newer revision';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'TEST 7 PASSED: stale late build correctly rejected: %', SQLERRM;
    END;
END $$;

DO $$ BEGIN
  IF (SELECT status FROM calendar_timeline_builds WHERE id = 'b0000000-0000-0000-0000-000000000002') = 'CURRENT' THEN
    RAISE NOTICE 'TEST 7b PASSED: revision-2 build is STILL current after the stale publish attempt';
  ELSE
    RAISE EXCEPTION 'TEST 7b FAILED: version 2 was disturbed by the rejected stale build';
  END IF;
END $$;

-- =============================================================================
-- TEST 8: CLOSED-year protection — ordinary UPDATE blocked; correction works.
-- =============================================================================
SELECT fn_transition_academic_year_status('a0000000-0000-0000-0000-000000000019', 'READY');
SELECT fn_transition_academic_year_status('a0000000-0000-0000-0000-000000000019', 'ACTIVE');
SELECT fn_transition_academic_year_status('a0000000-0000-0000-0000-000000000019', 'CLOSED');

DO $$
BEGIN
    UPDATE academic_years SET end_date = '2027-07-10' WHERE id = 'a0000000-0000-0000-0000-000000000019';
    IF (SELECT end_date FROM academic_years WHERE id = 'a0000000-0000-0000-0000-000000000019') = '2027-07-10' THEN
        RAISE EXCEPTION 'TEST 8 FAILED: ordinary UPDATE succeeded against a CLOSED academic year';
    ELSE
        RAISE NOTICE 'TEST 8 PASSED: ordinary UPDATE against a CLOSED year silently affected 0 rows (RLS)';
    END IF;
END $$;

SELECT fn_apply_calendar_correction(
    'a0000000-0000-0000-0000-000000000019', 'ACADEMIC_YEAR_END', NULL, NULL, NULL,
    '2027-07-10', 'Ministry issued a one-week extension after year close.'
);

DO $$ BEGIN
  IF (SELECT end_date FROM academic_years WHERE id = 'a0000000-0000-0000-0000-000000000019') = '2027-07-10' THEN
    RAISE NOTICE 'TEST 8b PASSED: fn_apply_calendar_correction updated the CLOSED year''s end date';
  ELSE
    RAISE EXCEPTION 'TEST 8b FAILED';
  END IF;
  IF (SELECT count(*) FROM calendar_corrections WHERE academic_year_id = 'a0000000-0000-0000-0000-000000000019') = 1 THEN
    RAISE NOTICE 'TEST 8c PASSED: correction record was written';
  ELSE
    RAISE EXCEPTION 'TEST 8c FAILED';
  END IF;
END $$;

-- =============================================================================
-- TEST 9: a permission-less user cannot call the correction RPC.
-- =============================================================================
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('app.current_uid', '22222222-2222-2222-2222-222222222222', false);

DO $$
BEGIN
    BEGIN
        PERFORM fn_apply_calendar_correction(
            'a0000000-0000-0000-0000-000000000019', 'ACADEMIC_YEAR_END', NULL, NULL, NULL,
            '2027-08-01', 'Unauthorized attempt.'
        );
        RAISE EXCEPTION 'TEST 9 FAILED: permission-less user was able to apply a correction';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'TEST 9 PASSED: permission-less user blocked from fn_apply_calendar_correction: %', SQLERRM;
    END;
END $$;

RESET ROLE;
RESET app.current_uid;

-- =============================================================================
-- TEST A: a SUSPENDED user holding the Admin role is still blocked by
-- has_permission() at the database layer (defense in depth beyond withAuth()).
-- =============================================================================
SET ROLE authenticated;
SELECT set_config('app.current_uid', '33333333-3333-3333-3333-333333333333', false);

DO $$
BEGIN
    IF has_permission('calendar.manage') THEN
        RAISE EXCEPTION 'TEST A FAILED: a SUSPENDED user passed has_permission(''calendar.manage'')';
    ELSE
        RAISE NOTICE 'TEST A PASSED: SUSPENDED user blocked by has_permission() despite holding the Admin role';
    END IF;
END $$;

RESET ROLE;
RESET app.current_uid;

-- =============================================================================
-- TEST B: withAuth()'s exact read (`SELECT id, user_type, status FROM users
-- WHERE supabase_uid = ...`) through RLS, for ACTIVE, SUSPENDED, and an
-- unlinked Supabase Auth identity.
-- =============================================================================
SET ROLE authenticated;
SELECT set_config('app.current_uid', '11111111-1111-1111-1111-111111111111', false);
DO $$
DECLARE v_status TEXT;
BEGIN
    SELECT status INTO v_status FROM users WHERE supabase_uid = '11111111-1111-1111-1111-111111111111';
    IF v_status = 'ACTIVE' THEN
        RAISE NOTICE 'TEST B PASSED: withAuth()-shaped query sees ACTIVE for the admin user';
    ELSE
        RAISE EXCEPTION 'TEST B FAILED: expected ACTIVE, got %', v_status;
    END IF;
END $$;
RESET ROLE;
RESET app.current_uid;

SET ROLE authenticated;
SELECT set_config('app.current_uid', '33333333-3333-3333-3333-333333333333', false);
DO $$
DECLARE v_status TEXT;
BEGIN
    SELECT status INTO v_status FROM users WHERE supabase_uid = '33333333-3333-3333-3333-333333333333';
    IF v_status = 'SUSPENDED' THEN
        RAISE NOTICE 'TEST Bb PASSED: withAuth()-shaped query sees SUSPENDED — the app layer would now reject with 403 ACCOUNT_SUSPENDED';
    ELSE
        RAISE EXCEPTION 'TEST Bb FAILED: expected SUSPENDED, got %', v_status;
    END IF;
END $$;
RESET ROLE;
RESET app.current_uid;

SET ROLE authenticated;
SELECT set_config('app.current_uid', '99999999-9999-9999-9999-999999999999', false);
DO $$
DECLARE v_count INT;
BEGIN
    SELECT count(*) INTO v_count FROM users WHERE supabase_uid = '99999999-9999-9999-9999-999999999999';
    IF v_count = 0 THEN
        RAISE NOTICE 'TEST Bc PASSED: a signed-in Supabase Auth identity with no linked users row returns zero rows — the app layer would reject with 401 UNAUTHENTICATED';
    ELSE
        RAISE EXCEPTION 'TEST Bc FAILED: expected 0 rows for an unlinked identity, got %', v_count;
    END IF;
END $$;
RESET ROLE;
RESET app.current_uid;

-- =============================================================================
-- TEST C: resolveEffectivePermissions()'s own two raw queries, through RLS —
-- not just has_permission() — for both the role-granted and direct-grant path.
-- =============================================================================
SET ROLE authenticated;
SELECT set_config('app.current_uid', '11111111-1111-1111-1111-111111111111', false);
DO $$
DECLARE
    v_count INT;
BEGIN
    -- Mirrors engine.ts's first query: user_roles -> roles -> role_permissions -> permissions.
    SELECT count(*) INTO v_count
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id AND p.resource = 'calendar'
    WHERE ur.user_id = '00000000-0000-0000-0000-000000000001';
    IF v_count = 7 THEN
        RAISE NOTICE 'TEST C PASSED: role-granted path resolves all 7 calendar.* keys through RLS';
    ELSE
        RAISE EXCEPTION 'TEST C FAILED: expected 7 role-granted calendar.* keys, got %', v_count;
    END IF;
END $$;
RESET ROLE;
RESET app.current_uid;

SET ROLE authenticated;
SELECT set_config('app.current_uid', '44444444-4444-4444-4444-444444444444', false);
DO $$
DECLARE
    v_key TEXT;
    v_count INT;
BEGIN
    -- Mirrors engine.ts's second query: user_permissions -> permissions (direct grant).
    SELECT count(*) INTO v_count
    FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id
    WHERE up.user_id = '00000000-0000-0000-0000-000000000004';
    SELECT p.resource || '.' || p.action INTO v_key
    FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
    WHERE up.user_id = '00000000-0000-0000-0000-000000000004';
    IF v_count = 1 AND v_key = 'calendar.view' THEN
        RAISE NOTICE 'TEST Cb PASSED: direct-grant path resolves exactly calendar.view through RLS';
    ELSE
        RAISE EXCEPTION 'TEST Cb FAILED: expected exactly 1 row (calendar.view), got % row(s), key=%', v_count, v_key;
    END IF;

    -- And the role path returns nothing for this user (no role assigned).
    SELECT count(*) INTO v_count FROM user_roles WHERE user_id = '00000000-0000-0000-0000-000000000004';
    IF v_count = 0 THEN
        RAISE NOTICE 'TEST Cc PASSED: viewer-only user has no role-granted permissions';
    ELSE
        RAISE EXCEPTION 'TEST Cc FAILED: viewer-only user unexpectedly has % role assignment(s)', v_count;
    END IF;
END $$;
RESET ROLE;
RESET app.current_uid;

-- =============================================================================
-- TEST D: calendar.view-only user can SELECT academic_years, but an ordinary
-- INSERT (needs calendar.manage) is invisible to them (0 rows affected/read).
-- =============================================================================
SET ROLE authenticated;
SELECT set_config('app.current_uid', '44444444-4444-4444-4444-444444444444', false);
DO $$
DECLARE v_count INT;
BEGIN
    SELECT count(*) INTO v_count FROM academic_years WHERE id = 'a0000000-0000-0000-0000-000000000019';
    IF v_count = 1 THEN
        RAISE NOTICE 'TEST D PASSED: calendar.view-only user CAN read the academic year';
    ELSE
        RAISE EXCEPTION 'TEST D FAILED: calendar.view-only user could not read the academic year';
    END IF;

    BEGIN
        INSERT INTO academic_years (id, year_ec, name, start_date, end_date, status, created_by)
        VALUES ('a0000000-0000-0000-0000-00000000002a', 2020, '2020 E.C.', '2027-09-15', '2028-07-07', 'PREPARING', NULL);
        RAISE EXCEPTION 'TEST Db FAILED: calendar.view-only user was able to INSERT an academic year';
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN
        RAISE NOTICE 'TEST Db PASSED: calendar.view-only user blocked from creating an academic year: %', SQLERRM;
    END;
END $$;
RESET ROLE;
RESET app.current_uid;

\echo '============================================================'
\echo 'ALL STANDALONE VERIFICATION TESTS COMPLETED'
\echo '============================================================'
