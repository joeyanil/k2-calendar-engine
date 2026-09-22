# Implementation Notes

## Architecture decision: `lib/calendar/` as a pure domain module

K2's documented backend convention (`06_Backend_Architecture.md`) is flat
`lib/services/*.service.ts` files mixing business rules and Supabase calls.
This implementation instead keeps `src/lib/calendar/` completely free of
any database or framework import — every function takes plain data in and
returns plain data out. `src/lib/services/*.service.ts` is a thinner layer
on top that does the Supabase reads/writes and calls into `lib/calendar/`.

This is a deliberate, spec-directed deviation, not an accident: mission
section 42 explicitly requires "Domain logic / Persistence / API / UI" to
stay cleanly separated, and section 3 authorizes changing the existing
convention wherever the target design requires it. The payoff is concrete:
all 155 tests in `tests/calendar/` run in milliseconds with no database at
all, including the full 2019 E.C. workflow test against real Ministry data.

## Resolved during the v2 repair pass — kept here for the record, not as open questions

### Student Return vs. the default year boundary — RESOLVED

Previously flagged as an open question: Student Return falls on **Meskerem
4**, one day before the default academic-year boundary's start of
**Meskerem 5**, taken literally putting Student Return outside its own
year. This is now confirmed as a real, permanent feature of the actual
2019 E.C. calendar, not an artifact of missing evidence:
`Ministry_plan_2019.md` (the real Ministry document, supplied during the v2
repair pass) states Meskerem 4 as the explicit class-placement/orientation
day and Meskerem 5 as the explicit first day of regular classes — the same
one-day gap, independently confirmed. `CALENDAR_STUDENT_RETURN_OUTSIDE_YEAR_BOUNDARY`
remains a WARNING, not an ERROR, for the same reason as always (an admin
who hasn't replaced the default boundary yet shouldn't be blocked), but
this is no longer an open question about what the real Ministry practice
is — `tests/calendar/2019-workflow.test.ts` demonstrates both the literal
default-boundary case (Part 1) and the corrected one (Part 2) against real
data.

### 2019 E.C. semester and exam dates — RESOLVED

Previously flagged as unavailable: `Ministry_plan_2019.md` now supplies
real semester activity dates and all five exam windows explicitly.
`tests/calendar/2019-workflow.test.ts` uses them directly (see that file's
own header for the full sourcing of every value, including three specific,
disclosed discrepancies the real data surfaced: an absent Fasika date in
this particular source document, an internal one-day conflict in the
source about which day classes truly begin, and — found by actually
running the comparison, not assumed — the source's own literal S1 exam
window landing on a real weekend, which `checkExamHardStops` correctly
rejects).

## Still genuinely open

### Exact permission key names

`calendar.view`, `calendar.manage`, `calendar.manage_holidays`,
`calendar.manage_exams`, `calendar.manage_dependencies`,
`calendar.build_timeline`, and `calendar.correct_history` (Migration 0012)
are this implementation's best judgment at a `resource.action`-shaped key
set matching K2's documented RBAC convention. There is still no real K2
codebase to reconcile these against — this genuinely cannot be resolved
until this merges into one. When it does, reconcile these seven keys
against whatever naming convention is actually in use, and assign them to
the appropriate roles through K2's existing role-management UI.

## What's built vs. what a production merge still needs

**Built and verified (tests + a real local Postgres, re-verified after
every change in the v2 zero-trust repair pass — see
`VERIFICATION_PATCH_NOTES.md` and `V2_REPAIR_NOTES.md`):** the full domain
engine including real dependency resolution, all 18 migrations (schema,
RLS, triggers, RPCs, a real configuration-revision system, lifecycle
integrity, dependency integrity, multi-fact timeline days), the service
layer, 21 API routes, and a working admin UI. `npm run build` produces a
real, deployable Next.js production build. This is not "135 tests
passing" as a proxy for correctness — see `V2_REPAIR_NOTES.md` for what
was independently verified against real Postgres beyond the test suite:
concurrent-publish races, direct-database-bypass attempts, closed-year
insertion attempts, and multi-fact persistence, among others.

**Still needed before this is live in a real K2 deployment** (disclosed,
not hidden behind a "production-ready" claim):

1. **Wire into the real K2 base schema.** This was built and verified
   against `supabase/dev-fixtures/`'s and `supabase/standalone/`'s
   stand-ins for `users`, `has_permission()`, `audit_logs`, etc. Point it
   at the real ones instead.
2. **Reminder delivery.** `reminders.ts` decides *when* a reminder fires;
   nothing in this delivery yet actually calls a real notification
   dispatch engine — that integration point doesn't exist as code yet
   either, in this standalone experiment or in a real K2 codebase.
3. **Attendance integration.** A real `attendance.service.ts` should call
   `getDay()` / `getTeachingDaySummary()` from `calendarTimeline.service.ts`
   to decide availability — not built here since that service doesn't
   exist as code yet.
4. **Real K2 auth.** The standalone bootstrap (`supabase/standalone/`)
   provides genuine, independently-verified auth for running this alone;
   merging into real K2 means switching to K2's own login flow and user
   model instead.
5. **Rollover UI.** `rollover.ts`'s domain logic (scaffold next year,
   suggest — never auto-apply — prior dependencies) has no admin-facing
   screen yet; only the pure functions and their tests exist.
