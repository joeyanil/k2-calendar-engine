import { describe, expect, it } from 'vitest'
import { isoDate } from '@/lib/calendar/date-utils'
import {
  assertNoConflictingIncomingRules,
  findConflictingIncomingRules,
  resolveAllDependentFacts,
  resolveCalendarConfiguration,
} from '@/lib/calendar/dependencyResolution'
import { factRefKey } from '@/lib/calendar/types'
import type { CalendarConfiguration, DependencyRule } from '@/lib/calendar/types'
import { AppError } from '@/lib/errors/AppError'

function rule(over: Partial<DependencyRule> & Pick<DependencyRule, 'anchor' | 'dependent' | 'offsetDays'>): DependencyRule {
  return {
    id: Math.random().toString(),
    academicYearId: 'y',
    active: true,
    createdByUserId: 'u',
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

function baseConfig(): CalendarConfiguration {
  return {
    academicYear: { id: 'y', startDate: isoDate('2026-09-11'), endDate: isoDate('2027-07-08') },
    semesters: [
      { id: 's1', academicYearId: 'y', order: 1, startDate: isoDate('2026-09-11'), endDate: isoDate('2026-12-25'), status: 'ACTIVE' },
      { id: 's2', academicYearId: 'y', order: 2, startDate: isoDate('2027-01-25'), endDate: isoDate('2027-07-08'), status: 'UPCOMING' },
    ],
    holidayOccurrences: [
      { id: 'h1', academicYearId: 'y', holidayTypeKey: 'FASIKA', date: isoDate('2027-05-02'), closesSchool: true, source: 'ADMIN_ENTERED', confirmedByUserId: 'u', confirmedAt: '2026-01-01T00:00:00Z' },
    ],
    examInstances: [],
    studentReturn: null,
  }
}

describe('dependency resolution: fix #8 — a declared dependency actually changes the resolved fact', () => {
  it('resolves a single dependent as anchor + offset, not its own raw value', () => {
    const raw = new Map([[factRefKey({ kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: 'FASIKA' }), isoDate('2027-05-02')]])
    const rules = [
      rule({
        anchor: { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: 'FASIKA' },
        dependent: { kind: 'EXAM_START', examTypeKey: 'S2_FINAL' },
        offsetDays: 10,
      }),
    ]
    const resolved = resolveAllDependentFacts(raw, rules)
    expect(resolved.get(factRefKey({ kind: 'EXAM_START', examTypeKey: 'S2_FINAL' }))).toBe(isoDate('2027-05-12'))
  })

  it('resolves a chain A -> B -> C transitively, in topological order regardless of input order', () => {
    const raw = new Map([[factRefKey({ kind: 'ACADEMIC_YEAR_START' }), isoDate('2026-09-11')]])
    // Deliberately supplied out of dependency order to prove this isn't
    // relying on array order to happen to work.
    const rules = [
      rule({ anchor: { kind: 'SEMESTER_START', order: 1 }, dependent: { kind: 'STUDENT_RETURN' }, offsetDays: -1 }),
      rule({ anchor: { kind: 'ACADEMIC_YEAR_START' }, dependent: { kind: 'SEMESTER_START', order: 1 }, offsetDays: 5 }),
    ]
    const resolved = resolveAllDependentFacts(raw, rules)
    expect(resolved.get(factRefKey({ kind: 'SEMESTER_START', order: 1 }))).toBe(isoDate('2026-09-16'))
    expect(resolved.get(factRefKey({ kind: 'STUDENT_RETURN' }))).toBe(isoDate('2026-09-15'))
  })

  it('a dependent fact never falls back to its own raw stored value, even if one exists', () => {
    // The raw map has a stored value for EXAM_START S2_FINAL, but an active
    // rule governs it — the stored value must never leak through.
    const raw = new Map([
      [factRefKey({ kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: 'FASIKA' }), isoDate('2027-05-02')],
      [factRefKey({ kind: 'EXAM_START', examTypeKey: 'S2_FINAL' }), isoDate('1999-01-01')], // stale/wrong stored value
    ])
    const rules = [
      rule({ anchor: { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: 'FASIKA' }, dependent: { kind: 'EXAM_START', examTypeKey: 'S2_FINAL' }, offsetDays: 10 }),
    ]
    const resolved = resolveAllDependentFacts(raw, rules)
    expect(resolved.get(factRefKey({ kind: 'EXAM_START', examTypeKey: 'S2_FINAL' }))).toBe(isoDate('2027-05-12'))
  })

  it('a dependent whose anchor does not exist is left unresolved (MISSING), not defaulted', () => {
    const raw = new Map<string, ReturnType<typeof isoDate>>() // no facts entered at all
    const rules = [
      rule({ anchor: { kind: 'EXAM_START', examTypeKey: 'S1_FINAL' }, dependent: { kind: 'EXAM_START', examTypeKey: 'S2_FINAL' }, offsetDays: 5 }),
    ]
    const resolved = resolveAllDependentFacts(raw, rules)
    expect(resolved.has(factRefKey({ kind: 'EXAM_START', examTypeKey: 'S2_FINAL' }))).toBe(false)
  })

  it('an inactive rule has no effect on resolution at all', () => {
    const raw = new Map([[factRefKey({ kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: 'FASIKA' }), isoDate('2027-05-02')]])
    const rules = [
      rule({ anchor: { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: 'FASIKA' }, dependent: { kind: 'EXAM_START', examTypeKey: 'S2_FINAL' }, offsetDays: 10, active: false }),
    ]
    const resolved = resolveAllDependentFacts(raw, rules)
    expect(resolved.has(factRefKey({ kind: 'EXAM_START', examTypeKey: 'S2_FINAL' }))).toBe(false)
  })
})

describe('dependency resolution: fix #12 — conflicting incoming rules', () => {
  it('finds no conflicts when every dependent has at most one active incoming rule', () => {
    const rules = [
      rule({ anchor: { kind: 'ACADEMIC_YEAR_START' }, dependent: { kind: 'SEMESTER_START', order: 1 }, offsetDays: 1 }),
      rule({ anchor: { kind: 'SEMESTER_START', order: 1 }, dependent: { kind: 'STUDENT_RETURN' }, offsetDays: -1 }),
    ]
    expect(findConflictingIncomingRules(rules).size).toBe(0)
    expect(() => assertNoConflictingIncomingRules(rules)).not.toThrow()
  })

  it('detects two active rules targeting the same dependent', () => {
    const rules = [
      rule({ anchor: { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: 'FASIKA' }, dependent: { kind: 'EXAM_START', examTypeKey: 'S2_FINAL' }, offsetDays: 10 }),
      rule({ anchor: { kind: 'SEMESTER_END', order: 2 }, dependent: { kind: 'EXAM_START', examTypeKey: 'S2_FINAL' }, offsetDays: -3 }),
    ]
    const conflicts = findConflictingIncomingRules(rules)
    expect(conflicts.size).toBe(1)
    expect(() => assertNoConflictingIncomingRules(rules)).toThrow(AppError)
  })

  it('does not flag a conflict when the second rule is inactive', () => {
    const rules = [
      rule({ anchor: { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: 'FASIKA' }, dependent: { kind: 'EXAM_START', examTypeKey: 'S2_FINAL' }, offsetDays: 10 }),
      rule({ anchor: { kind: 'SEMESTER_END', order: 2 }, dependent: { kind: 'EXAM_START', examTypeKey: 'S2_FINAL' }, offsetDays: -3, active: false }),
    ]
    expect(() => assertNoConflictingIncomingRules(rules)).not.toThrow()
  })
})

describe('dependency resolution: resolveCalendarConfiguration — full pipeline wiring', () => {
  it('with no dependency rules, returns the raw configuration unchanged', () => {
    const raw = baseConfig()
    const resolved = resolveCalendarConfiguration(raw, [])
    expect(resolved).toEqual(raw)
  })

  it('a dependent exam keeps its row identity but its date is overridden to the anchor-derived value, never its own stored one', () => {
    const raw = baseConfig()
    raw.examInstances.push({
      id: 'e1',
      academicYearId: 'y',
      examTypeKey: 'S2_FINAL',
      startDate: isoDate('1999-01-01'), // placeholder seed date, e.g. from initial entry before the dependency was declared
      endDate: isoDate('1999-01-03'),
    })
    const rules = [
      rule({ anchor: { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: 'FASIKA' }, dependent: { kind: 'EXAM_START', examTypeKey: 'S2_FINAL' }, offsetDays: 14 }),
      rule({ anchor: { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: 'FASIKA' }, dependent: { kind: 'EXAM_END', examTypeKey: 'S2_FINAL' }, offsetDays: 16 }),
    ]
    const resolved = resolveCalendarConfiguration(raw, rules)
    const exam = resolved.examInstances.find((e) => e.examTypeKey === 'S2_FINAL')
    expect(exam).toBeDefined()
    expect(exam?.id).toBe('e1') // same fact identity, not a different one
    expect(exam?.startDate).toBe(isoDate('2027-05-16'))
    expect(exam?.endDate).toBe(isoDate('2027-05-18'))
  })

  it('a dependent exam whose row does not exist at all yet stays absent — a dependency governs an existing fact, it does not conjure a new one', () => {
    const raw = baseConfig() // no S2_FINAL row in examInstances at all
    const rules = [
      rule({ anchor: { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: 'FASIKA' }, dependent: { kind: 'EXAM_START', examTypeKey: 'S2_FINAL' }, offsetDays: 14 }),
      rule({ anchor: { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: 'FASIKA' }, dependent: { kind: 'EXAM_END', examTypeKey: 'S2_FINAL' }, offsetDays: 16 }),
    ]
    const resolved = resolveCalendarConfiguration(raw, rules)
    expect(resolved.examInstances.find((e) => e.examTypeKey === 'S2_FINAL')).toBeUndefined()
  })

  it('a dependent semester with an unresolvable anchor gets null dates, not stale ones', () => {
    const raw = baseConfig()
    const rules = [
      // Anchor is an exam that was never entered -> unresolvable.
      rule({ anchor: { kind: 'EXAM_END', examTypeKey: 'S1_FINAL' }, dependent: { kind: 'SEMESTER_START', order: 2 }, offsetDays: 30 }),
    ]
    const resolved = resolveCalendarConfiguration(raw, rules)
    const sem2 = resolved.semesters.find((s) => s.order === 2)
    expect(sem2?.startDate).toBeNull()
    // Still exactly two semester objects — the fix #5 invariant survives resolution.
    expect(resolved.semesters).toHaveLength(2)
  })

  it('throws CALENDAR_CIRCULAR_DEPENDENCY rather than looping forever if a cycle somehow reaches this point', () => {
    const raw = baseConfig()
    const rules = [
      rule({ anchor: { kind: 'SEMESTER_START', order: 1 }, dependent: { kind: 'STUDENT_RETURN' }, offsetDays: -1 }),
      rule({ anchor: { kind: 'STUDENT_RETURN' }, dependent: { kind: 'SEMESTER_START', order: 1 }, offsetDays: 1 }),
    ]
    expect(() => resolveCalendarConfiguration(raw, rules)).toThrow(AppError)
  })

  it('throws CALENDAR_CONFLICTING_DEPENDENCY rather than silently picking one rule', () => {
    const raw = baseConfig()
    const rules = [
      rule({ anchor: { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: 'FASIKA' }, dependent: { kind: 'EXAM_START', examTypeKey: 'S2_FINAL' }, offsetDays: 10 }),
      rule({ anchor: { kind: 'SEMESTER_END', order: 2 }, dependent: { kind: 'EXAM_START', examTypeKey: 'S2_FINAL' }, offsetDays: -3 }),
    ]
    expect(() => resolveCalendarConfiguration(raw, rules)).toThrow(AppError)
  })
})
