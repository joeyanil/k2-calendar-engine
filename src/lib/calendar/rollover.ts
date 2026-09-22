/**
 * rollover.ts — mission section 35, Deep Domain File 4 §J.
 *
 * "Rollover carries shape, not historical data." Concretely, what actually
 * needs to be produced for a brand-new academic year is small: a default
 * boundary and two empty semester shells. The permanent facts (weekly
 * pattern, the holiday catalog, the exam catalog) are system-wide constants
 * (holidays.ts / exams.ts), not per-year data that needs copying at all —
 * which is itself the point: there is no copyable "last year's holiday
 * list" because the catalog was never year-scoped in the first place.
 *
 * The one thing that legitimately carries forward is a *suggestion*: if the
 * previous year had an explicit DEPENDENT relationship declared, the admin
 * may want the same relationship this year. It is offered, never applied.
 */
import { ethiopianDate } from './ethiopian-date'
import type { ISODate } from './date-utils'
import type { AcademicYear, CalendarFactRef, DependencyRule } from './types'

export interface NewYearScaffold {
  suggestedYearEc: number
  suggestedName: string
  defaultStartDate: ISODate // Meskerem 5
  defaultEndDate: ISODate // Sene 30
}

/** Proposes the next Ethiopian year number and the usable default boundary
 *  for it (mission item 5's Meskerem-5 -> Sene-30 default, applied to the
 *  new year rather than the one being rolled over from). Nothing here reads
 *  the previous year's actual dates — only its year number, to increment. */
export function scaffoldNextAcademicYear(previousYear: Pick<AcademicYear, 'yearEc'>): NewYearScaffold {
  const suggestedYearEc = previousYear.yearEc + 1
  return {
    suggestedYearEc,
    suggestedName: `${suggestedYearEc} E.C.`,
    defaultStartDate: ethiopianDate(suggestedYearEc, 1, 5), // Meskerem 5
    defaultEndDate: ethiopianDate(suggestedYearEc, 10, 30), // Sene 30
  }
}

export interface DependencySuggestion {
  anchor: CalendarFactRef
  dependent: CalendarFactRef
  offsetDays: number
  /** True only if both `anchor` and `dependent` fact types are known to
   *  exist as configurable facts in the new year — i.e. the suggestion is
   *  safe to present as one click away, not merely theoretically valid. */
  targetsExistInNewYear: boolean
}

/** Every currently-known Calendar fact "kind" — used to sanity-check that a
 *  suggested dependency's anchor/dependent still refer to something the new
 *  year's Calendar Engine actually has a slot for, before the suggestion is
 *  even shown as safe to accept (mission section 35: "verify referenced
 *  types/entities exist in the new year... before acceptance"). This is a
 *  structural check on the *kind* of fact, not a lookup of last year's
 *  concrete row — the whole point of rollover is that no concrete row
 *  carries over. */
function factKindIsAddressable(ref: CalendarFactRef): boolean {
  switch (ref.kind) {
    case 'ACADEMIC_YEAR_START':
    case 'ACADEMIC_YEAR_END':
    case 'SEMESTER_START':
    case 'SEMESTER_END':
    case 'HOLIDAY_OCCURRENCE':
    case 'EXAM_START':
    case 'EXAM_END':
    case 'STUDENT_RETURN':
      return true
    default:
      return false
  }
}

/**
 * Turns the previous year's active DEPENDENT rules into suggestions for the
 * new year. Never returns something already "accepted" — every suggestion
 * requires an explicit admin action in the new year before it becomes a
 * real `DependencyRule` there (mission section 35: "Never apply it
 * automatically").
 */
export function suggestDependencyRollover(previousYearRules: DependencyRule[]): DependencySuggestion[] {
  return previousYearRules
    .filter((r) => r.active)
    .map((r) => ({
      anchor: r.anchor,
      dependent: r.dependent,
      offsetDays: r.offsetDays,
      targetsExistInNewYear: factKindIsAddressable(r.anchor) && factKindIsAddressable(r.dependent),
    }))
}
