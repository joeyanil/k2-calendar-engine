# Legacy Removal — mapping old K2 design to the new Calendar Engine

The "old" K2 design referenced below exists only as architecture
documentation (`00-source.zip`'s `03_Database_Design.md`,
`06_Backend_Architecture.md`) — no actual code had been written yet
("Implementation not yet started" per `00_README.md`). This file records,
for every legacy concept the mission (§49) named explicitly, what replaces
it and why, so nothing from the old design accidentally survives as a
second source of truth once real implementation starts from these docs.

| Old design (docs only) | Replaced by | Why |
|---|---|---|
| `academic_years.school_weekdays` | Nothing — Mon–Fri is a fixed rule in `date-utils.ts`'s `isWeekend()` | Mission §7: the weekly pattern is permanent, never per-year configuration. |
| `year_status`: PLANNING/ACTIVE/FINALIZATION/ARCHIVED | `academic_year_status`: PREPARING/READY/ACTIVE/CLOSED | Mission §5. ARCHIVED was never a business state; technical archival is a separate, unrelated concern. |
| `semester_status`: UPCOMING/ACTIVE/LOCKED/ARCHIVED | `semester_status`: UPCOMING/ACTIVE/CLOSED | Mission §6. |
| 2-or-4 semester configurability | Exactly two, `sem_order SMALLINT CHECK (sem_order IN (1,2))` | Mission §6. Historical 4-semester years are a migration/preservation problem, not application logic. |
| `unlockSemester()` | Does not exist. `fn_transition_semester_status` only allows UPCOMING→ACTIVE→CLOSED. | Mission §36: CLOSED is a one-way door; reopening is a correction, not an unlock. |
| `seedNationalHolidays()`'s Bahire-Hasab auto-calculation of movable holidays | `holidays.ts`'s `assertMovableHolidayManuallyEntered` + the `fn_validate_holiday_occurrence` DB trigger — both reject any movable holiday whose `source` isn't `ADMIN_ENTERED` | Mission §8: the engine calculates none of the four movable holidays, ever. Verified in `holidays.test.ts` and in the live-database functional test suite (TEST 3), which both attempt an `AUTO_PROPOSED` movable holiday and confirm it's rejected. |
| `non_school_days` (generic table, `EXAM` rows among others) | `exam_instances` (first-class, per exam type) + `holiday_occurrences` | Mission §9, §49: exams and holidays are first-class Calendar facts with their own rules (day numbering, hard stops), not interchangeable rows in one bucket. |
| `events.EXAM`, `events.HOLIDAY`, "also mark as non-school day" | Removed. General Events (`ACADEMIC`/`CEREMONY`/`CLUB`/`STAFF`/`SPORTS`) remain a separate table this engine never writes to. | Mission §11, §49: General Events must never become a second authority for official Calendar facts. |
| Legacy `isSchoolDay()` / `getSchoolDaysInPeriod()` computing their own answer | `teachingDays.ts`'s `countTeachingDays()` / `countAvailableDays()`, reading `calendar_timeline_days` | Mission §23: no consumer independently reconstructs "what today means" — everything reads the one published timeline. |
| Calendar gating Registration (Phase-1 assumption) | Registration is entirely independent; Calendar never queries it | Mission §12, Deep Domain File 5. |
| Calendar owning or copying bell schedules / timetables | Not present anywhere in this schema or domain layer | Mission §13: Staffing owns the bell schedule and timetable entirely. |

## What was deliberately NOT ported forward

- Any notion of a school-configurable weekly pattern.
- Any per-year "holiday list" as year-scoped catalog data — `holiday_types`
  and `exam_types` are system-wide, seeded once, referenced by every year.
- Any code path that computes a movable holiday's date.
- Any "reopen a closed semester" capability, under any name.
