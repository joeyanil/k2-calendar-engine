-- =============================================================================
-- Calendar Engine — Migration 0019: Closed-Year Insertion Protection
--
-- v2 zero-trust repair, closing fixes #22/#23/#25. Migration 0017 already
-- fixed this exact gap for calendar_dependencies; this does the same for
-- the three remaining fact tables where UPDATE was already protected
-- against a CLOSED year but ordinary INSERT was not — an authenticated
-- caller with the relevant permission could still acquire a brand new
-- holiday, exam, or Student Return row into a year that is supposed to be
-- permanently historical. Formal correction (fn_apply_calendar_correction)
-- remains the only approved path into closed history, unaffected by this
-- change since it is a controlled RPC, not an ordinary table INSERT.
-- =============================================================================

DROP POLICY holiday_occurrences_insert_manage ON holiday_occurrences;
CREATE POLICY holiday_occurrences_insert_manage ON holiday_occurrences
    FOR INSERT TO authenticated
    WITH CHECK (
        has_permission('calendar.manage_holidays')
        AND (SELECT status FROM academic_years WHERE id = academic_year_id) <> 'CLOSED'
    );

DROP POLICY exam_instances_insert_manage ON exam_instances;
CREATE POLICY exam_instances_insert_manage ON exam_instances
    FOR INSERT TO authenticated
    WITH CHECK (
        has_permission('calendar.manage_exams')
        AND (SELECT status FROM academic_years WHERE id = academic_year_id) <> 'CLOSED'
    );

DROP POLICY student_return_days_insert_manage ON student_return_days;
CREATE POLICY student_return_days_insert_manage ON student_return_days
    FOR INSERT TO authenticated
    WITH CHECK (
        has_permission('calendar.manage')
        AND (SELECT status FROM academic_years WHERE id = academic_year_id) <> 'CLOSED'
    );
