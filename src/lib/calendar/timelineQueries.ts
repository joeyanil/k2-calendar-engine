/**
 * timelineQueries.ts — mission section 24.
 *
 * "The stored authoritative unit is the daily timeline. Build views as
 * projections." Nothing here creates a new business fact — every function
 * is a pure grouping/lookup over an already-built `DailyTimelineEntry[]`.
 */
import { isSameOrAfter, isSameOrBefore } from './date-utils'
import type { ISODate } from './date-utils'
import type { DailyTimelineEntry } from './types'

/** Day view: one authoritative date's complete state, or null if the date
 *  falls outside the timeline that was searched. */
export function getDay(entries: DailyTimelineEntry[], date: ISODate): DailyTimelineEntry | null {
  return entries.find((e) => e.date === date) ?? null
}

/** Range view: every entry in [start, end] inclusive. */
export function getRange(
  entries: DailyTimelineEntry[],
  start: ISODate,
  end: ISODate,
): DailyTimelineEntry[] {
  return entries.filter((e) => isSameOrAfter(e.date, start) && isSameOrBefore(e.date, end))
}

/** Month view (Gregorian calendar month, "YYYY-MM"), grouping timeline
 *  dates rather than tracking months as a separate authority. */
export function groupByGregorianMonth(entries: DailyTimelineEntry[]): Map<string, DailyTimelineEntry[]> {
  const groups = new Map<string, DailyTimelineEntry[]>()
  for (const entry of entries) {
    const monthKey = entry.date.slice(0, 7) // "YYYY-MM"
    const list = groups.get(monthKey)
    if (list) list.push(entry)
    else groups.set(monthKey, [entry])
  }
  return groups
}

/** Month view (Ethiopian calendar month, "YYYY-MM" in Ethiopian terms) —
 *  the view an admin actually expects when looking at "Meskerem" on
 *  screen, still just a grouping over the same authoritative entries. */
export function groupByEthiopianMonth(entries: DailyTimelineEntry[]): Map<string, DailyTimelineEntry[]> {
  const groups = new Map<string, DailyTimelineEntry[]>()
  for (const entry of entries) {
    const monthKey = `${entry.ethiopian.year}-${String(entry.ethiopian.month).padStart(2, '0')}`
    const list = groups.get(monthKey)
    if (list) list.push(entry)
    else groups.set(monthKey, [entry])
  }
  return groups
}

/** Week view: groups consecutive entries into Monday-Sunday weeks. The
 *  first and last groups may be partial if the timeline doesn't start on a
 *  Monday / end on a Sunday — that's a property of the academic year
 *  boundary, not something this function should paper over by inventing
 *  dates outside the timeline. */
export function groupByWeek(entries: DailyTimelineEntry[]): DailyTimelineEntry[][] {
  const weeks: DailyTimelineEntry[][] = []
  let currentWeek: DailyTimelineEntry[] = []

  for (const entry of entries) {
    currentWeek.push(entry)
    if (entry.weekday === 'SUNDAY') {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }
  if (currentWeek.length > 0) weeks.push(currentWeek)
  return weeks
}
