-- =============================================================================
-- Calendar Engine — Migration 0010: Formal Corrections
-- mission §37. An immutable audit trail, structurally identical in spirit
-- to `audit_logs` (REVOKE UPDATE/DELETE) — corrections are themselves
-- historical facts once made.
-- =============================================================================

CREATE TABLE calendar_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,

    fact_kind calendar_fact_kind NOT NULL,
    fact_semester_order SMALLINT CHECK (fact_semester_order IN (1, 2)),
    fact_holiday_type_key holiday_type_key,
    fact_exam_type_key exam_type_key,

    original_value DATE NOT NULL,
    corrected_value DATE NOT NULL,
    reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
    performed_by UUID NOT NULL REFERENCES users(id),
    performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_calendar_corrections_year ON calendar_corrections(academic_year_id, performed_at DESC);

-- Immutable once written — same reasoning as audit_logs (Migration 010/011
-- in the base schema): a correction record is only trustworthy if it can
-- never itself be quietly edited or removed.
REVOKE UPDATE, DELETE ON calendar_corrections FROM authenticated, anon;

ALTER TABLE calendar_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_corrections_select_authenticated ON calendar_corrections
    FOR SELECT TO authenticated
    USING (has_permission('calendar.view'));

-- No direct INSERT policy for `authenticated` — corrections are only ever
-- created through fn_apply_calendar_correction() (Migration 0013), which
-- is SECURITY DEFINER and independently checks calendar.correct_history,
-- mission §45's "the stronger administrative capability already supported
-- by K2."
