/**
 * dependencyResolution.ts — v2 repair fix #8, #12, #13.
 *
 * Closes the gap the repair guide identified precisely: `calendar_dependencies`
 * rows, cycle detection, and `previewDependencyImpact` all existed, but
 * nothing ever fed an active rule's result into the configuration the
 * timeline builder actually consumes. A DEPENDENT fact's own stored date
 * column was the only thing ever read — declaring "Exam B follows Holiday A
 * by 2 days" had no effect on Exam B's real date at all.
 *
 * This module is the missing middle step:
 *   raw authoritative facts -> dependency resolution -> resolved facts
 * `resolveCalendarConfiguration` is what `calendarTimeline.service.ts` now
 * calls between loading the raw snapshot and calling `buildFullYearTimeline`.
 *
 * Fix #13's rule is enforced structurally here, not by convention: a
 * DEPENDENT fact's own stored date is never read for its resolved value —
 * only an anchor-derived one is. If the anchor can't be resolved (doesn't
 * exist yet, or the chain bottoms out), the dependent fact is treated as
 * MISSING (omitted / nulled, matching how "not entered yet" is already
 * represented everywhere else), never silently falling back to a stale
 * stored value. That is the "no two contradictory authorities" rule made
 * concrete: there is exactly one path to a dependent fact's value once a
 * rule governs it.
 */
import { AppError } from '../errors/AppError'
import { addDays } from './date-utils'
import type { ISODate } from './date-utils'
import { detectAnyCycle } from './dependencyGraph'
import type { CalendarConfiguration, CalendarFactRef, DependencyRule } from './types'
import { factRefKey } from './types'

/** Non-throwing finder — every dependent fact key that currently has 2+
 *  active incoming rules, with the conflicting rules themselves. Used both
 *  by the throwing assertion below (resolution / insert-time paths) and by
 *  validation.ts (which collects this as a reportable ERROR rather than
 *  throwing, consistent with every other structural rule it reports). */
export function findConflictingIncomingRules(rules: DependencyRule[]): Map<string, DependencyRule[]> {
  const incoming = new Map<string, DependencyRule[]>()
  for (const rule of rules) {
    if (!rule.active) continue
    const key = factRefKey(rule.dependent)
    const list = incoming.get(key)
    if (list) list.push(rule)
    else incoming.set(key, [rule])
  }
  for (const key of [...incoming.keys()]) {
    if ((incoming.get(key)?.length ?? 0) < 2) incoming.delete(key)
  }
  return incoming
}

/** Fix #12: a calendar fact must have at most one ACTIVE incoming
 *  dependency. Two rules both targeting the same dependent — even if their
 *  offsets differ, even if one is "really" intended to replace the other —
 *  have no deterministic resolution, and this module refuses to invent a
 *  "first/last one wins" tiebreak. Chains (A -> B -> C) are unaffected:
 *  this only rejects two or more edges landing on the *same* dependent. */
export function assertNoConflictingIncomingRules(rules: DependencyRule[]): void {
  const conflicts = findConflictingIncomingRules(rules)
  for (const [key, conflicting] of conflicts) {
    throw new AppError(
      'CALENDAR_CONFLICTING_DEPENDENCY',
      422,
      `"${key}" has ${conflicting.length} active incoming dependencies (from ${conflicting
        .map((r) => factRefKey(r.anchor))
        .join(', ')}) — a calendar fact must have exactly one authoritative source.`,
    )
  }
}

/** Every independently-stored date in a configuration, keyed the same way
 *  dependency rules reference facts. Dual purpose: as the *seed* for
 *  resolution (raw config in) and, called again on an already-resolved
 *  config, as the real "current resolved facts" map the impact preview
 *  needs to report accurate old -> new deltas (fix #14) — a resolved
 *  config's dependent-fact dates already reflect resolution, so this
 *  function does not need to know or care which facts are independent vs.
 *  dependent; it just reads whatever is actually in front of it. */
export function factMapFromConfiguration(config: CalendarConfiguration): Map<string, ISODate> {
  const map = new Map<string, ISODate>()
  map.set(factRefKey({ kind: 'ACADEMIC_YEAR_START' }), config.academicYear.startDate)
  map.set(factRefKey({ kind: 'ACADEMIC_YEAR_END' }), config.academicYear.endDate)
  for (const s of config.semesters) {
    if (s.startDate) map.set(factRefKey({ kind: 'SEMESTER_START', order: s.order }), s.startDate)
    if (s.endDate) map.set(factRefKey({ kind: 'SEMESTER_END', order: s.order }), s.endDate)
  }
  for (const h of config.holidayOccurrences) {
    map.set(factRefKey({ kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: h.holidayTypeKey }), h.date)
  }
  for (const e of config.examInstances) {
    map.set(factRefKey({ kind: 'EXAM_START', examTypeKey: e.examTypeKey }), e.startDate)
    map.set(factRefKey({ kind: 'EXAM_END', examTypeKey: e.examTypeKey }), e.endDate)
  }
  if (config.studentReturn) {
    map.set(factRefKey({ kind: 'STUDENT_RETURN' }), config.studentReturn.date)
  }
  return map
}

/**
 * Resolves every fact governed by an active dependency to
 * anchor's-resolved-date + offset, propagated through chains, in
 * topological order. Facts with no active incoming rule keep their raw
 * stored value untouched. A fact that IS governed by a rule never falls
 * back to its own raw stored value under any circumstance, including when
 * it cannot be resolved (its entry is removed instead — see the module
 * docstring).
 */
export function resolveAllDependentFacts(rawFacts: Map<string, ISODate>, rules: DependencyRule[]): Map<string, ISODate> {
  const activeRules = rules.filter((r) => r.active)
  const pending = new Map<string, DependencyRule>()
  for (const rule of activeRules) pending.set(factRefKey(rule.dependent), rule)

  const resolved = new Map(rawFacts)
  // A dependent's raw stored value (if any) must never leak through as its
  // resolved value — only an anchor-derived one may. Clear it up front.
  for (const key of pending.keys()) resolved.delete(key)

  let progressed = true
  while (pending.size > 0 && progressed) {
    progressed = false
    for (const [dependentKey, rule] of pending) {
      const anchorKey = factRefKey(rule.anchor)
      if (pending.has(anchorKey)) continue // anchor itself still unresolved — wait for a later pass
      const anchorDate = resolved.get(anchorKey)
      if (anchorDate === undefined) continue // anchor fact doesn't exist at all (e.g. not entered yet)
      resolved.set(dependentKey, addDays(anchorDate, rule.offsetDays))
      pending.delete(dependentKey)
      progressed = true
    }
  }
  // Anything still pending here has an anchor that will never resolve
  // (detectAnyCycle in resolveCalendarConfiguration is the real guard
  // against true cycles reaching this point at all) — leave it absent
  // rather than ever falling back to a stale stored value.
  return resolved
}

/**
 * The real pipeline step (guide §56): raw facts -> dependency graph
 * validation -> dependency resolution -> resolved facts, ready for
 * `buildFullYearTimeline`. Throws before ever touching the timeline if the
 * dependency graph itself is unsound (a cycle that should have been
 * rejected at insert time, or two conflicting incoming rules) — a
 * malformed dependency graph must never silently produce a plausible-
 * looking but wrong timeline.
 */
export function resolveCalendarConfiguration(
  raw: CalendarConfiguration,
  rules: DependencyRule[],
): CalendarConfiguration {
  const cycle = detectAnyCycle(rules)
  if (cycle) {
    throw new AppError(
      'CALENDAR_CIRCULAR_DEPENDENCY',
      500,
      `Circular calendar dependency reached the build pipeline (should have been rejected at insert time): ${cycle.join(' -> ')}`,
    )
  }
  assertNoConflictingIncomingRules(rules)

  const resolved = resolveAllDependentFacts(factMapFromConfiguration(raw), rules)
  const dateFor = (ref: CalendarFactRef): ISODate | undefined => resolved.get(factRefKey(ref))

  return {
    academicYear: {
      ...raw.academicYear,
      startDate: dateFor({ kind: 'ACADEMIC_YEAR_START' }) ?? raw.academicYear.startDate,
      endDate: dateFor({ kind: 'ACADEMIC_YEAR_END' }) ?? raw.academicYear.endDate,
    },
    semesters: raw.semesters.map((s) => ({
      ...s,
      startDate: dateFor({ kind: 'SEMESTER_START', order: s.order }) ?? null,
      endDate: dateFor({ kind: 'SEMESTER_END', order: s.order }) ?? null,
    })),
    // A dependent holiday/exam whose anchor can't be resolved is dropped
    // entirely, not kept with a stale date — HolidayOccurrence.date and
    // ExamInstance.startDate/endDate are non-nullable by design (the row
    // existing at all means it has a real date), so "unresolved" and
    // "doesn't exist yet" are the same state, matching how every other
    // not-yet-entered fact is already represented.
    // Same boundary as examInstances below: a dependency governs an
    // existing holiday occurrence's date, not its existence.
    holidayOccurrences: raw.holidayOccurrences.flatMap((h) => {
      const date = dateFor({ kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: h.holidayTypeKey })
      return date ? [{ ...h, date }] : []
    }),
    // A dependency governs an EXISTING fact's date, not its existence — the
    // admin still creates the exam/holiday/student-return row once (its
    // initial date is irrelevant, since resolution immediately overrides
    // it), and only then can a dependency take over its date going
    // forward. This isn't a limitation so much as a deliberate boundary:
    // exam_instances.start_date/end_date are NOT NULL by schema design, and
    // exam_instances is the one place that answers "which exams exist" for
    // the setup UI, corrections, and everything else — a dependency
    // conjuring a phantom exam with no real row would make the timeline
    // show something the rest of the app doesn't know exists.
    examInstances: raw.examInstances.flatMap((e) => {
      const startDate = dateFor({ kind: 'EXAM_START', examTypeKey: e.examTypeKey })
      const endDate = dateFor({ kind: 'EXAM_END', examTypeKey: e.examTypeKey })
      return startDate && endDate ? [{ ...e, startDate, endDate }] : []
    }),
    studentReturn: raw.studentReturn
      ? (() => {
          const date = dateFor({ kind: 'STUDENT_RETURN' })
          return date ? { ...raw.studentReturn, date } : null
        })()
      : null,
  }
}
