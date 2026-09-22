# V2 Zero-Trust Repair — Changelog

This documents the repair pass that followed an independent architecture
audit of the standalone deliverable. Every item below was independently
confirmed as a real, reproducible defect against the actual code before
being fixed — not accepted on the audit's word alone (see the chat history
for the specific evidence gathered for each "CRITICAL" item before any
code was touched). Every fix was then re-verified against real PostgreSQL
and the full application gate (lint, typecheck, tests, build), and both
full functional-verification suites were re-run after every phase.

**Note on process:** the final phase of this pass was meant to be an
additional, fresh, from-scratch re-verification on top of the per-phase
verification below (extract clean, reinstall clean, apply all 19
migrations in one continuous run, re-run the full bypass/concurrency test
matrix end to end). That final confirmatory pass was explicitly skipped at
the requester's direction before packaging. Every phase below was still
independently verified as it was built — this note exists so that
distinction is not lost.

## Phase 1 — Real configuration revision (Migration 0015)

- Replaced `configVersion = highest existing build + 1` (a build counter)
  with `academic_years.calendar_config_revision`, a real revision the
  database advances only on a genuine change to an authoritative fact,
  via triggers on every fact table. Verified this closes the exact gap
  the old design had: built a candidate, mutated a fact with **no second
  build ever created**, and confirmed the old logic would have let the
  stale candidate publish while the new logic correctly rejects it.
- New `fn_load_calendar_config_snapshot()` — a torn-read-safe snapshot
  (revision-checked before and after assembly, bounded retry) replacing
  five independent parallel queries.
- `fn_publish_calendar_timeline` rewritten: staleness is now
  `candidate.source_config_revision <> year's LIVE revision`, plus real
  structural verification (exact day count, exact span, year match) —
  previously only version ordering and status were checked.
- `fn_check_timeline_day_year_matches_build` trigger — a `timeline_day`
  can no longer disagree with its build about which year it belongs to,
  for any role including `service_role`.
- `search_path` hardened on all 5 pre-existing `SECURITY DEFINER`
  functions (none had it before this phase).
- Found and fixed two real bugs in this phase's own first draft while
  testing it: a column-level `REVOKE` that silently did nothing (Postgres
  table-level grants override column-level ones), and a psql quirk where
  `:variables` don't interpolate inside `$$...$$` blocks.

## Phase 2 — Lifecycle integrity (Migration 0016)

- `fn_create_default_semesters` trigger — creating an academic year now
  atomically creates exactly two semesters (UPCOMING, dates NULL). If the
  trigger fails, the whole year-creation statement rolls back with it.
- `status` on `academic_years` and `semesters` is no longer reachable via
  ordinary `UPDATE` from `authenticated` — only through the transition
  RPCs. (Correctly implemented this time using the revoke-table-grant,
  re-grant-by-column pattern learned from Phase 1's bug.)
- Real activation readiness gate: the existing (previously never-invoked)
  `validateCalendarConfiguration` now actually blocks READY/ACTIVE on any
  MISSING or ERROR severity issue, plus a minimal DB-level structural
  backstop (semester dates must be set) reachable even if the TypeScript
  layer is bypassed entirely.
- Both regression fixtures required real changes, not just renames: they
  previously manually inserted semester rows, which now collide with the
  new trigger — rewritten to go through the real dates-then-activate
  workflow, which is itself evidence the fix has real teeth.

## Phase 3 — Dependencies actually wired in (Migration 0017)

- New `dependencyResolution.ts`: raw facts → resolve active dependencies
  → resolved facts, now actually called by `buildCandidateTimeline`
  before `buildFullYearTimeline`. Previously, dependency rows, cycle
  detection, and impact preview all existed but nothing fed a resolved
  value into the actual timeline.
- Conflicting active incoming dependencies (two rules targeting the same
  fact) rejected at three layers: a pure finder, a service-layer
  pre-check, and now a DB trigger mirroring the existing cycle check.
- The "no silent second authority" guard (fix #13): editing a fact's own
  date is now rejected with a clear error if a dependency governs it —
  wired into all four relevant service functions.
- Fixed the actual empty-map bug in the dependency impact preview — it
  now loads and resolves the real configuration instead of comparing
  against nothing.
- Closed-year INSERT protection added to `calendar_dependencies`.
- One real design decision surfaced by testing: a dependency governs an
  *existing* fact's date, not its existence (exam_instances dates are
  `NOT NULL` by schema) — documented in code, not silently patched around.

## Phase 4 — Multi-fact dates (Migration 0018)

- `DailyTimelineEntry.holiday`/`.exam` (singular — silently dropped data)
  → `.holidays[]`/`.exams[]` + derived `holidayClosure`, propagated
  through the domain layer, service layer, DB schema, and UI.
- The bug went one layer deeper than expected: `indexHolidaysByDate`'s
  single-value return meant the exam and Student Return hard-stop checks
  could *also* silently miss a closing holiday if a non-closing one was
  indexed first on the same date — fixed at the source.
- New `checkExamOverlap()`: two school-closing exams overlapping is now a
  real WARNING. Grounded in the Deep Domain files, not guessed: the Grade
  12 National Exam legitimately overlapping a standard exam is confirmed
  as the *normal* case (K2 doesn't host it, the rest of the school runs
  as usual) and is explicitly excluded from the conflict check.
- `confirmFixedHoliday()` + `POST .../holidays/:key/confirm` — closes the
  actual confirmation-workflow gap (the fields existed on the type from
  the start; nothing had ever set them for a fixed holiday).
- **Schema change required, not just an in-memory fix**: `calendar_timeline_days`
  only had singular `holiday_type_key`/`exam_type_key` columns — even a
  correct in-memory fix would have lost the second fact at the
  persistence boundary. Replaced with JSONB arrays.
- Proven against real Postgres: a timeline day persisting 2 holidays and
  a Grade-12 exam simultaneously, read back intact.

## Phase 5 — Real date validation and request-body validation

- Seven independent `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` implementations
  (format-only — `2026-02-30` passed) consolidated into one shared
  `isoDateSchema`, built on the domain layer's own real calendar-validity
  checker.
- Three routes that destructured raw JSON with no schema validation at
  all (both lifecycle transitions, `publish`'s `buildId`) now validate
  through the same pattern every other route already used.
- The permissive `factRefSchema` (order optional for every kind,
  `holidayTypeKey`/`examTypeKey` as arbitrary strings, propped up with
  `as never` casts downstream) replaced with a real discriminated union
  using the actual 9-holiday/5-exam catalogs. Verified with 8 adversarial
  cases (missing order, arbitrary key, wrong companion field, extraneous
  field) — every unsafe cast this schema had forced downstream is gone.

## Phase 6 — Real Ministry-plan test and documentation honesty (Migration 0019)

- `tests/calendar/2019-workflow.test.ts` rewritten against the actual
  supplied Ministry document. Every date is sourced or explicitly flagged
  as an interpretation or a disclosed gap (see that file's own header for
  the full sourcing of every value).
- **Found and independently triple-verified a genuine discrepancy**: the
  Ministry document's own literal S1 regional exam window (Hidar 3-7)
  spans a real weekend (Nov 14-15, 2026) once converted — confirmed via
  Python's stdlib, the `kenat` library directly, and K2's own conversion,
  ruling out a coding defect before concluding it was a real source-data
  problem. `checkExamHardStops` correctly rejects the literal window; the
  test proves this rather than silently using a corrected date.
- Also surfaced and disclosed: Fasika (Easter Sunday) is entirely absent
  from this Ministry document's own holiday register — a value used
  elsewhere in the codebase for it does not trace to this source.
- Independently confirmed K2's hardcoded default year boundary (Meskerem
  5 → Sene 30) matches real Ministry practice on both ends, closing a
  previously-open question about whether it was an arbitrary placeholder.
- `IMPLEMENTATION_NOTES.md` rewritten: two "open questions" marked
  resolved with the real evidence above; the genuinely-still-open one
  (permission key names, unresolvable without a real K2 codebase) kept
  and clearly separated from the resolved ones.
- Found and fixed a real bug in `DEPLOYMENT.md` itself: its literal
  migration file list was missing 4 files (0015-0018) — a deployer
  following it verbatim would have ended up with an incomplete database.
- Closed the remaining closed-year INSERT gaps (holidays, exams, student
  return) — the same class of loophole already closed for dependencies in
  Phase 3, adversarially tested against real Postgres including a sanity
  check that normal (non-closed-year) inserts still work.

## Final state

- `npm run lint`, `npx tsc --noEmit`, `npm test` (155/155), `npm run build`
  all clean as of the last full gate run.
- 19 migrations (0001-0014 unchanged from the standalone deliverable,
  0015-0019 new in this pass) apply cleanly in order to real PostgreSQL.
- Both functional-verification suites (`dev-fixtures/02_functional_verification.sql`,
  17 tests; `standalone/local-verification/verify_standalone.sql`, 24
  tests) pass in full against real PostgreSQL as of the last run.

## Deliberately out of scope for this pass (disclosed, not hidden)

- **UI wiring for the new capabilities.** The confirm-holiday action,
  staleness indicator, and dependency management have no admin-facing
  screen yet — only the API routes and domain logic exist and are tested.
  Building and testing new UI screens properly is a separate, sizeable
  unit of work this pass did not start.
- **Reminder delivery and attendance integration** — unchanged from the
  standalone deliverable's own disclosed non-goals; still no dispatcher
  or attendance service exists as code to integrate with.
- **Rollover UI** — the pure domain functions and their tests exist;
  still no admin-facing screen.
- **Malformed-UUID path parameters** across routes generally fail safely
  today (a 500 via Postgres's own type error, caught generically) rather
  than a clean 422 in every case — fixing this fully would mean a shared
  Postgres-error-mapping layer across many service functions, a real but
  lower-severity, separate unit of work from what this pass covered.
- **The additional final from-scratch re-verification pass** described in
  the note at the top of this document.
