import { describe, expect, it } from 'vitest'
import { isoDate } from '@/lib/calendar/date-utils'
import {
  applyDependencyImpacts,
  assertNoCycle,
  detectAnyCycle,
  previewDependencyImpact,
  wouldCreateCycle,
} from '@/lib/calendar/dependencyGraph'
import { factRefKey } from '@/lib/calendar/types'
import type { CalendarFactRef, DependencyRule } from '@/lib/calendar/types'
import { AppError } from '@/lib/errors/AppError'

const STUDENT_RETURN: CalendarFactRef = { kind: 'STUDENT_RETURN' }
const S1_START: CalendarFactRef = { kind: 'SEMESTER_START', order: 1 }
const HOLIDAY_A: CalendarFactRef = { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: 'TIMKAT' }

function rule(anchor: CalendarFactRef, dependent: CalendarFactRef, offsetDays = 1): DependencyRule {
  return {
    id: `${factRefKey(anchor)}->${factRefKey(dependent)}`,
    academicYearId: 'y',
    anchor,
    dependent,
    offsetDays,
    active: true,
    createdByUserId: 'u1',
    createdAt: '2026-09-01T00:00:00Z',
  }
}

describe('dependencyGraph: cycle detection', () => {
  it('allows a simple non-cyclical dependency', () => {
    const existing: DependencyRule[] = []
    expect(wouldCreateCycle(existing, { anchor: S1_START, dependent: STUDENT_RETURN })).toBe(false)
  })

  it('rejects a fact depending on itself', () => {
    expect(wouldCreateCycle([], { anchor: S1_START, dependent: S1_START })).toBe(true)
  })

  it('detects a direct two-node cycle (A -> B, then proposing B -> A)', () => {
    const existing = [rule(S1_START, STUDENT_RETURN)]
    expect(wouldCreateCycle(existing, { anchor: STUDENT_RETURN, dependent: S1_START })).toBe(true)
  })

  it('detects a three-node cycle (A -> B -> C, then proposing C -> A)', () => {
    const existing = [rule(S1_START, STUDENT_RETURN), rule(STUDENT_RETURN, HOLIDAY_A)]
    expect(wouldCreateCycle(existing, { anchor: HOLIDAY_A, dependent: S1_START })).toBe(true)
  })

  it('does not flag an unrelated chain as cyclical', () => {
    const existing = [rule(S1_START, STUDENT_RETURN)]
    const unrelated: CalendarFactRef = { kind: 'EXAM_START', examTypeKey: 'S1_FINAL' }
    expect(wouldCreateCycle(existing, { anchor: HOLIDAY_A, dependent: unrelated })).toBe(false)
  })

  it('assertNoCycle throws an AppError with the circular-dependency code', () => {
    const existing = [rule(S1_START, STUDENT_RETURN)]
    expect(() => assertNoCycle(existing, { anchor: STUDENT_RETURN, dependent: S1_START })).toThrow(AppError)
  })

  it('ignores inactive rules when checking for cycles', () => {
    const existing = [{ ...rule(S1_START, STUDENT_RETURN), active: false }]
    expect(wouldCreateCycle(existing, { anchor: STUDENT_RETURN, dependent: S1_START })).toBe(false)
  })
})

describe('dependencyGraph: detectAnyCycle (aggregate safety net)', () => {
  it('finds no cycle in a clean acyclic graph', () => {
    const rules = [rule(S1_START, STUDENT_RETURN), rule(STUDENT_RETURN, HOLIDAY_A)]
    expect(detectAnyCycle(rules)).toBeNull()
  })

  it('finds a cycle if one has somehow been persisted', () => {
    // Contrived: simulate a cycle bypassing assertNoCycle (e.g. a direct write).
    const rules = [rule(S1_START, STUDENT_RETURN), rule(STUDENT_RETURN, S1_START)]
    expect(detectAnyCycle(rules)).not.toBeNull()
  })
})

describe('dependencyGraph: impact preview', () => {
  it('shows the direct dependent moving by its declared offset', () => {
    const rules = [rule(S1_START, STUDENT_RETURN, 2)]
    const impacts = previewDependencyImpact(S1_START, isoDate('2026-09-20'), rules, new Map())
    expect(impacts).toHaveLength(1)
    expect(impacts[0]).toMatchObject({ ref: STUDENT_RETURN, newDate: '2026-09-22' })
  })

  it('cascades through a chain of dependencies', () => {
    const rules = [rule(S1_START, STUDENT_RETURN, 1), rule(STUDENT_RETURN, HOLIDAY_A, 3)]
    const impacts = previewDependencyImpact(S1_START, isoDate('2026-09-20'), rules, new Map())
    expect(impacts).toHaveLength(2)
    const studentReturnImpact = impacts.find((i) => i.ref.kind === 'STUDENT_RETURN')
    const holidayImpact = impacts.find((i) => i.ref.kind === 'HOLIDAY_OCCURRENCE')
    expect(studentReturnImpact?.newDate).toBe('2026-09-21')
    expect(holidayImpact?.newDate).toBe('2026-09-24') // 21 + 3
  })

  it('reports the old date alongside the new one when known', () => {
    const rules = [rule(S1_START, STUDENT_RETURN, 2)]
    const resolved = new Map([[factRefKey(STUDENT_RETURN), isoDate('2026-09-19')]])
    const impacts = previewDependencyImpact(S1_START, isoDate('2026-09-20'), rules, resolved)
    expect(impacts[0]).toMatchObject({ oldDate: '2026-09-19', newDate: '2026-09-22' })
  })

  it('does not apply anything itself — the caller must accept explicitly', () => {
    const rules = [rule(S1_START, STUDENT_RETURN, 2)]
    const before = new Map([[factRefKey(STUDENT_RETURN), isoDate('2026-09-19')]])
    previewDependencyImpact(S1_START, isoDate('2026-09-20'), rules, before)
    expect(before.get(factRefKey(STUDENT_RETURN))).toBe('2026-09-19') // untouched
  })

  it('applyDependencyImpacts actually updates the resolved-facts map when accepted', () => {
    const rules = [rule(S1_START, STUDENT_RETURN, 2)]
    const before = new Map([[factRefKey(STUDENT_RETURN), isoDate('2026-09-19')]])
    const impacts = previewDependencyImpact(S1_START, isoDate('2026-09-20'), rules, before)
    const after = applyDependencyImpacts(before, impacts)
    expect(after.get(factRefKey(STUDENT_RETURN))).toBe('2026-09-22')
    expect(before.get(factRefKey(STUDENT_RETURN))).toBe('2026-09-19') // original map still untouched (immutability)
  })
})
