import { describe, expect, it } from 'vitest'
import { isoDate } from '@/lib/calendar/date-utils'
import { checkSemesterOrdering, deriveSemesterBreak } from '@/lib/calendar/semesterBreak'
import type { Semester } from '@/lib/calendar/types'

function semesters(s1End: string, s2Start: string): Semester[] {
  return [
    { id: 's1', academicYearId: 'y', order: 1, startDate: isoDate('2026-09-20'), endDate: isoDate(s1End), status: 'ACTIVE' },
    { id: 's2', academicYearId: 'y', order: 2, startDate: isoDate(s2Start), endDate: isoDate('2027-07-01'), status: 'UPCOMING' },
  ]
}

describe('semesterBreak: derivation', () => {
  it('derives the break as the day after S1 end through the day before S2 start', () => {
    const brk = deriveSemesterBreak(semesters('2027-01-15', '2027-02-01'))
    expect(brk).toEqual({ startDate: '2027-01-16', endDate: '2027-01-31' })
  })

  it('recomputes automatically when either boundary changes (never manually maintained)', () => {
    const original = deriveSemesterBreak(semesters('2027-01-15', '2027-02-01'))
    const afterS1Moves = deriveSemesterBreak(semesters('2027-01-20', '2027-02-01'))
    expect(afterS1Moves?.startDate).toBe('2027-01-21')
    expect(afterS1Moves?.startDate).not.toBe(original?.startDate)
  })

  it('returns null when either semester boundary is still missing', () => {
    const partial: Semester[] = [
      { id: 's1', academicYearId: 'y', order: 1, startDate: isoDate('2026-09-20'), endDate: null, status: 'ACTIVE' },
      { id: 's2', academicYearId: 'y', order: 2, startDate: isoDate('2027-02-01'), endDate: isoDate('2027-07-01'), status: 'UPCOMING' },
    ]
    expect(deriveSemesterBreak(partial)).toBeNull()
  })

  it('returns null (no break) when semester 2 starts the same day semester 1 ends', () => {
    expect(deriveSemesterBreak(semesters('2027-01-15', '2027-01-15'))).toBeNull()
  })
})

describe('semesterBreak: ordering validation', () => {
  it('is silent when semesters are correctly ordered with a real gap', () => {
    expect(checkSemesterOrdering(semesters('2027-01-15', '2027-02-01'))).toHaveLength(0)
  })

  it('errors when Semester 2 starts before Semester 1 ends (overlap)', () => {
    const issues = checkSemesterOrdering(semesters('2027-01-15', '2027-01-10'))
    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('ERROR')
    expect(issues[0]?.code).toBe('CALENDAR_SEMESTERS_OVERLAP')
  })

  it('warns (does not error) when there is no gap at all', () => {
    const issues = checkSemesterOrdering(semesters('2027-01-15', '2027-01-15'))
    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('WARNING')
    expect(issues[0]?.code).toBe('CALENDAR_NO_SEMESTER_BREAK')
  })
})
