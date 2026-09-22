import { describe, expect, it } from 'vitest'
import { scaffoldNextAcademicYear, suggestDependencyRollover } from '@/lib/calendar/rollover'
import type { DependencyRule } from '@/lib/calendar/types'

describe('rollover: scaffolding a new year', () => {
  it('proposes the next Ethiopian year number and a fresh default boundary', () => {
    const scaffold = scaffoldNextAcademicYear({ yearEc: 2019 })
    expect(scaffold.suggestedYearEc).toBe(2020)
    expect(scaffold.suggestedName).toBe('2020 E.C.')
    // Meskerem 5, 2020 and Sene 30, 2020 — not the previous year's actual dates.
    expect(scaffold.defaultStartDate < scaffold.defaultEndDate).toBe(true)
  })

  it('never reads or copies the previous year\'s actual configured dates', () => {
    // The function signature itself only accepts `yearEc` — there is no
    // parameter through which last year's real start/end/holiday dates
    // could flow into the new year's scaffold. This test documents that.
    const scaffold = scaffoldNextAcademicYear({ yearEc: 2019 })
    expect(Object.keys(scaffold)).toEqual([
      'suggestedYearEc',
      'suggestedName',
      'defaultStartDate',
      'defaultEndDate',
    ])
  })
})

describe('rollover: dependency suggestions are offered, never applied', () => {
  const previousYearRules: DependencyRule[] = [
    {
      id: 'r1',
      academicYearId: 'y2019',
      anchor: { kind: 'SEMESTER_START', order: 1 },
      dependent: { kind: 'STUDENT_RETURN' },
      offsetDays: -2,
      active: true,
      createdByUserId: 'u1',
      createdAt: '2026-08-01T00:00:00Z',
    },
  ]

  it('produces a suggestion object, not a new DependencyRule', () => {
    const suggestions = suggestDependencyRollover(previousYearRules)
    expect(suggestions).toHaveLength(1)
    // A suggestion has no `id`, no `academicYearId`, and no `active` flag —
    // it isn't a persisted rule, and can't accidentally be mistaken for one.
    expect(suggestions[0]).not.toHaveProperty('id')
    expect(suggestions[0]).not.toHaveProperty('academicYearId')
  })

  it('marks a suggestion as safe (targets exist) when both fact kinds are addressable', () => {
    const suggestions = suggestDependencyRollover(previousYearRules)
    expect(suggestions[0]?.targetsExistInNewYear).toBe(true)
  })

  it('excludes inactive rules from previous-year suggestions', () => {
    const withInactive = [...previousYearRules, { ...previousYearRules[0]!, id: 'r2', active: false }]
    expect(suggestDependencyRollover(withInactive)).toHaveLength(1)
  })
})
