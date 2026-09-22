-- =============================================================================
-- Calendar Engine — Migration 0001: Types & Catalogs
--
-- Run this AFTER the base K2 migrations (03_Database_Design.md Migrations
-- 001-003, 011, 012, 015) already exist — this migration only ever
-- references `users`, `has_permission()`, `fn_update_timestamp()`, and
-- `fn_audit_log()`, never redefines them.
--
-- This migration supersedes 03_Database_Design.md's old:
--   - Migration 004's `year_status` / `semester_status` enums (mission §5-6)
--   - Migration 022's "School Calendar (Non-School Days)" design (mission
--     §49: `non_school_days`, `seedNationalHolidays()`, generic EXAM/HOLIDAY
--     event categories) — see LEGACY_REMOVAL.md for the full mapping.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Academic Year & Semester lifecycles (mission §5-6)
-- ---------------------------------------------------------------------------
CREATE TYPE academic_year_status AS ENUM ('PREPARING', 'READY', 'ACTIVE', 'CLOSED');
CREATE TYPE semester_status AS ENUM ('UPCOMING', 'ACTIVE', 'CLOSED');

-- ---------------------------------------------------------------------------
-- Holidays (mission §8)
-- ---------------------------------------------------------------------------
CREATE TYPE holiday_type_key AS ENUM (
    'NEW_YEAR', 'GENNA', 'TIMKAT', 'ADWA', 'PATRIOTS',      -- fixed (5)
    'SIKLET', 'FASIKA', 'EID_FITR', 'EID_ADHA'              -- movable (4)
);
CREATE TYPE holiday_source AS ENUM ('AUTO_PROPOSED', 'ADMIN_ENTERED');

-- System-wide catalog — NOT per-year data. Seeded once, read by every year.
CREATE TABLE holiday_types (
    key holiday_type_key PRIMARY KEY,
    name TEXT NOT NULL,
    movable BOOLEAN NOT NULL,
    -- Only set for the five fixed holidays; NULL for all four movable ones,
    -- which have no calculable date by design (mission §8).
    fixed_month SMALLINT CHECK (fixed_month BETWEEN 1 AND 13),
    fixed_day SMALLINT CHECK (fixed_day BETWEEN 1 AND 30),
    CONSTRAINT chk_fixed_holiday_has_date
        CHECK ((movable AND fixed_month IS NULL AND fixed_day IS NULL)
            OR (NOT movable AND fixed_month IS NOT NULL AND fixed_day IS NOT NULL))
);

INSERT INTO holiday_types (key, name, movable, fixed_month, fixed_day) VALUES
    ('NEW_YEAR', 'Ethiopian New Year', FALSE, 1, 1),   -- Meskerem 1
    ('GENNA', 'Genna (Christmas)', FALSE, 4, 29),      -- Tahsas 29
    ('TIMKAT', 'Timkat (Epiphany)', FALSE, 5, 11),     -- Tir 11
    ('ADWA', 'Adwa Victory Day', FALSE, 6, 23),        -- Yekatit 23
    ('PATRIOTS', 'Patriots'' Day', FALSE, 8, 27),      -- Miazia 27
    ('SIKLET', 'Siklet (Good Friday)', TRUE, NULL, NULL),
    ('FASIKA', 'Fasika (Easter)', TRUE, NULL, NULL),
    ('EID_FITR', 'Eid al-Fitr', TRUE, NULL, NULL),
    ('EID_ADHA', 'Eid al-Adha (Arefa)', TRUE, NULL, NULL);

-- ---------------------------------------------------------------------------
-- Exams (mission §9)
-- ---------------------------------------------------------------------------
CREATE TYPE exam_type_key AS ENUM (
    'S1_REGIONAL_MODEL', 'S1_FINAL', 'S2_REGIONAL_MODEL', 'S2_FINAL', 'GRADE12_NATIONAL'
);
CREATE TYPE exam_grade_scope AS ENUM ('ALL', 'GRADE_12');

CREATE TABLE exam_types (
    key exam_type_key PRIMARY KEY,
    name TEXT NOT NULL,
    semester_order SMALLINT CHECK (semester_order IN (1, 2)), -- NULL for Grade 12 National
    closes_school BOOLEAN NOT NULL,
    grade_scope exam_grade_scope NOT NULL
);

INSERT INTO exam_types (key, name, semester_order, closes_school, grade_scope) VALUES
    ('S1_REGIONAL_MODEL', 'Semester 1 Regional Model Exam', 1, TRUE, 'ALL'),
    ('S1_FINAL', 'Semester 1 Final Exam', 1, TRUE, 'ALL'),
    ('S2_REGIONAL_MODEL', 'Semester 2 Regional Model Exam', 2, TRUE, 'ALL'),
    ('S2_FINAL', 'Semester 2 Final Exam', 2, TRUE, 'ALL'),
    ('GRADE12_NATIONAL', 'Grade 12 National Exam', NULL, FALSE, 'GRADE_12');

-- ---------------------------------------------------------------------------
-- The generic Calendar-fact-reference vocabulary (Deep Domain File 2 §E),
-- used by calendar_dependencies and calendar_corrections.
-- ---------------------------------------------------------------------------
CREATE TYPE calendar_fact_kind AS ENUM (
    'ACADEMIC_YEAR_START', 'ACADEMIC_YEAR_END',
    'SEMESTER_START', 'SEMESTER_END',
    'HOLIDAY_OCCURRENCE',
    'EXAM_START', 'EXAM_END',
    'STUDENT_RETURN'
);

-- Catalogs are reference data, not user data — readable by any authenticated
-- user, writable by nobody through the normal API (they change only via a
-- future migration, same as any other enum-like catalog in K2).
ALTER TABLE holiday_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY holiday_types_select_authenticated ON holiday_types FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY exam_types_select_authenticated ON exam_types FOR SELECT TO authenticated USING (TRUE);
REVOKE INSERT, UPDATE, DELETE ON holiday_types, exam_types FROM authenticated, anon;
