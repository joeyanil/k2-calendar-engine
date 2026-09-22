/**
 * studentReturn.ts — mission section 10 / Deep Domain File 2, Domain
 * Inventory item 8.
 *
 * Student Return / Orientation is its own first-class Calendar fact: open,
 * non-teaching, not attendance, not a holiday, and never represented as a
 * generic Events record. This module is intentionally tiny — the fact
 * itself is just one date — but it exists so the "it is not a holiday, not
 * an Event, and excluded from teaching days" rule has exactly one place to
 * be enforced rather than being reimplemented by every consumer.
 */
import type { ISODate } from './date-utils'
import type { HolidayOccurrence, StudentReturnDay, ValidationIssue } from './types'

/** Warns (does not block) if Student Return has been placed on the same
 *  date as a holiday occurrence — the two facts are allowed to coexist
 *  structurally, but that combination is almost certainly a data-entry
 *  mistake worth flagging (Deep Domain File 3 §G's "WARNING: something
 *  deserves attention but is not proven invalid" bucket). */
export function checkStudentReturnPlacement(
  studentReturn: StudentReturnDay | null,
  holidaysByDate: Map<ISODate, HolidayOccurrence[]>,
): ValidationIssue[] {
  if (!studentReturn) return []
  const holidays = holidaysByDate.get(studentReturn.date) ?? []
  return holidays.map((holiday) => ({
    severity: 'WARNING' as const,
    code: 'CALENDAR_STUDENT_RETURN_ON_HOLIDAY',
    message: `Student Return is set to ${studentReturn.date}, which also has a holiday occurrence recorded on it.`,
    ref: { kind: 'STUDENT_RETURN' as const },
    relatedRefs: [{ kind: 'HOLIDAY_OCCURRENCE' as const, holidayTypeKey: holiday.holidayTypeKey }],
  }))
}
