/**
 * semesterBreak.ts — mission section 20 / Deep Domain File 2 §E ("DERIVED").
 *
 * The semester break is never a primary, independently-editable fact. It is
 * always recomputed from Semester 1's end and Semester 2's start, so it can
 * never drift out of sync with the boundaries it comes from.
 */
import { addDays, isBefore, isSameOrBefore } from './date-utils'
import type { ISODate } from './date-utils'
import type { Semester, ValidationIssue } from './types'

export interface SemesterBreak {
  startDate: ISODate // Semester 1 end + 1 day
  endDate: ISODate // Semester 2 start - 1 day
}

/**
 * Derives the break range, or null if it can't be derived yet (either
 * semester's boundary is still Missing) or the two boundaries leave no gap
 * at all (Semester 2 starts the same day Semester 1 ends — an empty, not
 * negative, break: this function returns null and the caller's validation
 * pass reports it, rather than fabricating a break with zero length).
 */
export function deriveSemesterBreak(semesters: Semester[]): SemesterBreak | null {
  const s1 = semesters.find((s) => s.order === 1)
  const s2 = semesters.find((s) => s.order === 2)
  if (!s1?.endDate || !s2?.startDate) return null
  if (isSameOrBefore(s2.startDate, s1.endDate)) return null // overlap/touch — see validation.ts

  return {
    startDate: addDays(s1.endDate, 1),
    endDate: addDays(s2.startDate, -1),
  }
}

/** Structural check: Semester 2 must start strictly after Semester 1 ends,
 *  or there is no room for a break (mission item 20's derivation only makes
 *  sense when that holds). This is a structural invariant of the
 *  break-derivation rule itself, not an invented business policy — the two
 *  semesters overlapping or touching is unconditionally impossible in a
 *  system that also (item 6) treats semester dates as independent facts. */
export function checkSemesterOrdering(semesters: Semester[]): ValidationIssue[] {
  const s1 = semesters.find((s) => s.order === 1)
  const s2 = semesters.find((s) => s.order === 2)
  if (!s1?.endDate || !s2?.startDate) return []

  if (isBefore(s2.startDate, s1.endDate)) {
    return [
      {
        severity: 'ERROR',
        code: 'CALENDAR_SEMESTERS_OVERLAP',
        message: `Semester 2 starts (${s2.startDate}) before Semester 1 ends (${s1.endDate}). Semesters may not overlap.`,
        ref: { kind: 'SEMESTER_START', order: 2 },
        relatedRefs: [{ kind: 'SEMESTER_END', order: 1 }],
      },
    ]
  }
  if (s2.startDate === s1.endDate) {
    return [
      {
        severity: 'WARNING',
        code: 'CALENDAR_NO_SEMESTER_BREAK',
        message: `Semester 2 starts the same day Semester 1 ends (${s1.endDate}) — there is no gap for a semester break.`,
        ref: { kind: 'SEMESTER_START', order: 2 },
      },
    ]
  }
  return []
}
