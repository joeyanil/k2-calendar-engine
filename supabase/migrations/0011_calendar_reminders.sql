-- =============================================================================
-- Calendar Engine — Migration 0011: Reminders
-- mission §38-39. Stores the 30/15/5-day schedule computed by
-- reminders.ts's scheduleReminders(); a daily job reads rows due today and
-- hands them to K2's existing notification delivery mechanism.
-- =============================================================================

CREATE TYPE calendar_reminder_status AS ENUM ('PENDING', 'SKIPPED', 'SENT');

CREATE TABLE calendar_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,

    fact_kind calendar_fact_kind NOT NULL,
    fact_semester_order SMALLINT CHECK (fact_semester_order IN (1, 2)),
    fact_holiday_type_key holiday_type_key,
    fact_exam_type_key exam_type_key,

    threshold_days SMALLINT NOT NULL CHECK (threshold_days IN (30, 15, 5)),
    trigger_date DATE NOT NULL,
    due_date DATE NOT NULL,
    status calendar_reminder_status NOT NULL DEFAULT 'PENDING',
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (academic_year_id, fact_kind, fact_semester_order, fact_holiday_type_key, fact_exam_type_key, threshold_days)
);

-- The exact query the daily reminder job runs — "what fires today" —
-- backed by a partial index so it stays cheap regardless of history size.
CREATE INDEX idx_calendar_reminders_due_today
    ON calendar_reminders(trigger_date) WHERE status = 'PENDING';

-- A SENT reminder is historical (mission §37/§39) — never rewritten.
REVOKE UPDATE ON calendar_reminders FROM authenticated, anon;
-- (The reminder job itself runs as service_role, which bypasses RLS and
-- this REVOKE entirely, exactly like any other background job in
-- 06_Backend_Architecture.md §11.)

ALTER TABLE calendar_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_reminders_select_authenticated ON calendar_reminders
    FOR SELECT TO authenticated
    USING (has_permission('calendar.view'));
