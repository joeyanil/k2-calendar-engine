-- =============================================================================
-- Calendar Engine — Migration 0008: Timeline Builds & Daily Timeline
-- mission §15-23, §29-32 — the load-bearing core, persisted.
-- =============================================================================

CREATE TYPE timeline_build_status AS ENUM ('CANDIDATE', 'CURRENT', 'FAILED', 'SUPERSEDED');

CREATE TABLE calendar_timeline_builds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    status timeline_build_status NOT NULL DEFAULT 'CANDIDATE',
    -- The "build identity" mission §30 calls for — a monotonically
    -- increasing counter identifying which configuration produced this
    -- build, used to reject a stale candidate that finishes after a newer
    -- one has already published.
    config_version INT NOT NULL,
    config_hash TEXT NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    failure_reason TEXT
);

-- Exactly one CURRENT build per academic year — the database's own
-- guarantee that "what does today mean" never has two competing answers.
CREATE UNIQUE INDEX idx_one_current_build_per_year
    ON calendar_timeline_builds (academic_year_id) WHERE status = 'CURRENT';

CREATE INDEX idx_timeline_builds_year_version ON calendar_timeline_builds(academic_year_id, config_version DESC);

CREATE TABLE calendar_timeline_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    build_id UUID NOT NULL REFERENCES calendar_timeline_builds(id) ON DELETE CASCADE,
    -- Denormalized on purpose: every query this table serves ("give me the
    -- CURRENT timeline for year X") filters by year first, build second —
    -- see idx_timeline_days_year_date.
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    ethiopian_year INT NOT NULL,
    ethiopian_month SMALLINT NOT NULL CHECK (ethiopian_month BETWEEN 1 AND 13),
    ethiopian_day SMALLINT NOT NULL CHECK (ethiopian_day BETWEEN 1 AND 30),
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Sunday .. 6=Saturday
    is_weekend BOOLEAN NOT NULL,
    semester_order SMALLINT CHECK (semester_order IN (1, 2)),
    holiday_type_key holiday_type_key,
    holiday_closes_school BOOLEAN,
    exam_type_key exam_type_key,
    exam_day_number SMALLINT,
    exam_total_days SMALLINT,
    is_student_return BOOLEAN NOT NULL DEFAULT FALSE,
    is_semester_break BOOLEAN NOT NULL DEFAULT FALSE,
    school_open BOOLEAN NOT NULL,
    teaching_day BOOLEAN NOT NULL,
    attendance_available BOOLEAN NOT NULL,
    grade12_attendance_available BOOLEAN NOT NULL,
    reasons TEXT[] NOT NULL DEFAULT '{}',
    -- Every date exists exactly once per build (mission §16's core
    -- invariant, enforced declaratively as well as by timelineBuilder.ts's
    -- own verifyTimelineIntegrity()).
    UNIQUE (build_id, date)
);

CREATE INDEX idx_timeline_days_year_date ON calendar_timeline_days(academic_year_id, date);
CREATE INDEX idx_timeline_days_build ON calendar_timeline_days(build_id);

-- calendar_timeline_days rows are only ever inserted as a batch when a
-- candidate build is generated, and never updated afterward — a "change"
-- is always a brand new candidate build, never an edit to a published one
-- (mission §29's safe-rebuild model). Enforce that at the grant level.
REVOKE UPDATE ON calendar_timeline_days FROM authenticated, anon;

ALTER TABLE calendar_timeline_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_timeline_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_timeline_builds_select_authenticated ON calendar_timeline_builds
    FOR SELECT TO authenticated
    USING (has_permission('calendar.view'));

-- A CANDIDATE build (header row + its calendar_timeline_days) is inserted
-- directly by the service layer, computed by the pure TypeScript timeline
-- builder — ordinary INSERT, gated by permission. Promoting a candidate to
-- CURRENT is the part that genuinely needs database-level atomicity/locking
-- against concurrent publishes, which is exactly what
-- fn_publish_calendar_timeline() (Migration 0013) provides; nothing here
-- lets a row's `status` move to CURRENT except through that function.
CREATE POLICY calendar_timeline_builds_insert_manage ON calendar_timeline_builds
    FOR INSERT TO authenticated
    WITH CHECK (has_permission('calendar.build_timeline') AND status = 'CANDIDATE');

CREATE POLICY calendar_timeline_days_select_authenticated ON calendar_timeline_days
    FOR SELECT TO authenticated
    USING (has_permission('calendar.view'));

CREATE POLICY calendar_timeline_days_insert_manage ON calendar_timeline_days
    FOR INSERT TO authenticated
    WITH CHECK (
        has_permission('calendar.build_timeline')
        AND EXISTS (
            SELECT 1 FROM calendar_timeline_builds b
            WHERE b.id = calendar_timeline_days.build_id AND b.status = 'CANDIDATE'
        )
    );
