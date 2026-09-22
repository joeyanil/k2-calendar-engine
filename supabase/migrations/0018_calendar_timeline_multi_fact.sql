-- =============================================================================
-- Calendar Engine — Migration 0018: Multi-Fact Timeline Days
--
-- v2 zero-trust repair, Phase 4 (fixes #9, #16 — the database side).
--
-- The old single-value holiday_type_key/exam_type_key columns would have
-- silently lost data at the persistence boundary even after fixing the
-- in-memory representation in timelineBuilder.ts: a date with two holidays,
-- or a standard exam legitimately overlapping the Grade 12 National Exam
-- (Deep Domain File 5 §M — the normal case, not an edge case), could only
-- ever have ONE of those facts survive being saved. Replaced with JSONB
-- arrays holding every fact for the day, which is what TypeScript now
-- reads and writes exclusively — no singular column is kept alongside the
-- array as a redundant "primary" projection, since that would recreate
-- exactly the "two contradictory authorities" problem this whole repair
-- pass exists to close in a different area (dependencies).
-- =============================================================================

ALTER TABLE calendar_timeline_days
    DROP COLUMN holiday_type_key,
    DROP COLUMN holiday_closes_school,
    DROP COLUMN exam_type_key,
    DROP COLUMN exam_day_number,
    DROP COLUMN exam_total_days,
    ADD COLUMN holidays JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN holiday_closure BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN exams JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN calendar_timeline_days.holidays IS
    'Every holiday occurrence landing on this date: [{typeKey, name, closesSchool}, ...]. '
    'Almost always 0 or 1 entries, but never truncated to 1 if the Ministry plan ever '
    'puts two on the same date (Deep Domain File 3 §F).';
COMMENT ON COLUMN calendar_timeline_days.holiday_closure IS
    'Derived: true if ANY entry in holidays[] closes school. This, not any single '
    'holiday''s own closesSchool, is what schoolOpen/teachingDay actually consulted '
    'when this row was built.';
COMMENT ON COLUMN calendar_timeline_days.exams IS
    'Every exam whose window includes this date: [{typeKey, name, dayNumber, '
    'totalDays, closesSchool, gradeScope}, ...]. The Grade 12 National Exam '
    'legitimately coexisting with a standard exam here is the normal case this '
    'array exists for (Deep Domain File 5 §M), not an edge case.';
