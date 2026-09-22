# Verification & Remediation Patch Notes

This file documents every change made to the repository during the deep
zero-trust verification pass (see the accompanying verification report for
the full audit). Every fix below was made only after being independently
confirmed as a real, reproducible defect — nothing here is speculative.
After each fix, the full gate was re-run and stayed green: `npm run lint`,
`npx tsc --noEmit`, `npx vitest run` (135/135), and `npx next build`.

## Bugs fixed (source code)

1. **`semesters/[order]/route.ts` — invalid path segment silently accepted
   as semester 2.** The old code was `order === '1' ? 1 : 2`, so any value
   other than the literal string `'1'` — `'3'`, `'0'`, `'abc'`, an empty
   string — silently resolved to semester **2** instead of failing. A typo
   in a client or a malformed request could silently edit the wrong
   semester. Now parsed strictly: only `'1'` or `'2'` are accepted; anything
   else throws a `422 VALIDATION_ERROR` naming the bad value.

2. **`holidays/[key]/route.ts` and `exams/[key]/route.ts` — unchecked type
   casts on path segments.** Both routes took the raw `:key` URL segment
   and cast it directly to the enum type (`key as HolidayTypeKey` /
   `key as ExamTypeKey`) with no validation. A malformed key would reach
   Postgres, which would reject it as an invalid enum value, surfacing as a
   generic `500 CALENDAR_UPDATE_FAILED` / `500 CALENDAR_CREATE_FAILED`
   instead of a clean client error. Both routes now validate the segment
   against the real key catalog first and return a `422 VALIDATION_ERROR`
   naming the bad key.

3. **`timeline/day/route.ts` — unvalidated `?date=` query parameter.** The
   date string was cast straight to `ISODate` with only a presence check,
   not a format check. A malformed date (`?date=not-a-date`) would silently
   fail to match any timeline entry and return "not found" rather than
   explaining that the date itself was invalid. Now validated with
   `isValidISODate()` before use, returning a `422` that names the problem.

4. **`validation.ts` — redundant nested conditional (cleanup, not a bug).**
   The semester-start-boundary check wrapped an `isAfter(...)` check inside
   an outer `isSameOrAfter(...)` check that added nothing (the outer
   condition was always true whenever the inner one mattered). Flattened to
   the single necessary check. No behavior change — confirmed by the full
   test suite before and after.

5. **`SetupForm.tsx` — unescaped apostrophe.** `this year's Ministry plan`
   → `this year&apos;s Ministry plan`, fixing the one real
   `react/no-unescaped-entities` finding once lint was made to actually run
   (see below).

## Tooling fixed

6. **`npm run lint` was completely non-functional.** `eslint` was not a
   dependency at all, and no ESLint config file existed anywhere in the
   repo — running the documented script failed immediately with no
   config found. Added `eslint@9.39.5`, `eslint-config-next@15.5.25`, and
   `@eslint/eslintrc` as devDependencies, and added `eslint.config.mjs`
   (the standard Next.js 15 flat config: `next/core-web-vitals` +
   `next/typescript`). Lint now runs for real and passes clean (0 errors,
   0 warnings) after fix #5 above.

## Dependency vulnerabilities fixed

Before any changes, `npm audit` reported **12 vulnerabilities (2 critical,
3 high, 4 moderate, ... )**, most seriously:

- `next@15.5.4` — critical remote-code-execution advisory (CVE-2025-66478),
  plus a stack of other Next.js advisories fixed by the same line of patch
  releases.
- `@supabase/supabase-js` (pinned to a version bundling a vulnerable
  `@supabase/auth-js`) — a critical/high auth-routing advisory.

Fixed by bumping **within the same major/minor line wherever possible**, to
avoid an unverified breaking migration in a "ready to deploy" package:

| Package | Before | After | Why this version |
|---|---|---|---|
| `next` | 15.5.4 | **15.5.25** | Latest patch on the maintained 15.5.x line (`backport` dist-tag) — closes the critical RCE and every other 15.5.4-era advisory without a major-version jump to Next 16. |
| `@supabase/supabase-js` | 2.45.4 | **2.50.0** | The smallest bump that moves past the vulnerable auth-js range. **2.116.0 was tried first** (npm's own suggested "fix" version) but it introduced a breaking change to the `SupabaseClient<Database>` generic signature that broke the build across every route/service in the repo. 2.50.0 bundles a safe `@supabase/auth-js@2.70.0` while keeping the older, compatible client type contract — confirmed by a full lint/typecheck/test/build re-run. |
| `@supabase/ssr` | 0.5.1 | **0.5.2** | Patch bump paired with the supabase-js bump. |
| `postcss` | 8.4.47 | **8.5.28** (+ npm `overrides`) | Closes the CSS source-map path-traversal/disclosure advisories. An `overrides` entry was added because Next.js vendors its **own** copy of postcss internally (`next/node_modules/postcss@8.4.31`) that a normal dependency bump doesn't reach — the override forces the single patched version tree-wide, including inside Next's vendored copy, confirmed via `npm ls postcss`. |

**Deliberately not force-upgraded:** `npm audit fix --force` would also
install `vitest@5.0.0`, which:
- requires `@types/node@^22 || >=24` (a breaking bump from the pinned
  `20.16.5`), and
- failed to resolve cleanly against the current `vite` peer range without
  `--legacy-peer-deps`, i.e. an unverified, multi-package breaking
  migration of the test runner.

The vulnerability this would close (`vitest`/`vite`/`esbuild`/
`@vitest/mocker`, one rated critical) is real, but every one of these
packages is a **devDependency only** — confirmed absent from the
`next build` output — and the specific critical advisory
(GHSA-5xrq-8626-4rwp) requires the Vitest **UI server** (`vitest --ui`) to
be running and reachable, a mode this project's `package.json` scripts
never invoke. Forcing a major test-runner migration to close a
non-reachable, dev-only advisory risked destabilizing the "ready to
deploy" package for a real-world exposure of effectively zero in this
project's actual usage. This is flagged, not silently dropped — see the
main verification report's Section 20 for the full reasoning — and is the
one item a maintainer should revisit deliberately (as its own dedicated PR
with full test-runner re-validation) rather than as a drive-by dependency
bump.

**Final state:** `npm audit` → **5 vulnerabilities (1 critical, 1 high, 3
moderate), all confined to the vitest/vite/esbuild devDependency chain**,
none reachable in the deployed production build.

## What was intentionally left alone

Per the verification mission's own rule ("never invent missing Ministry
evidence, never silently resolve an open design question"), the following
were confirmed during verification but are **not** code defects and were
not touched:

- The open question of whether `studentReturn.date` should be allowed
  outside `[academicYear.startDate, academicYear.endDate]` for a mid-break
  return announced before the year's official start is a **product/policy
  question**, not a bug — resolving it either way without real Ministry
  guidance would be inventing a requirement. See the verification report.
- Everything under "Known non-goals" in `IMPLEMENTATION_NOTES.md` (no
  real authentication wiring, no attendance/reminder-delivery integration,
  `dev-fixtures/*.sql` standing in for a full Supabase project) is
  pre-existing, disclosed scope, not something this pass should silently
  paper over by fabricating stub integrations.
