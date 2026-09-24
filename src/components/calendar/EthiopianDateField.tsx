'use client'

import { useMemo, useState } from 'react'
import { toEthiopian, fromEthiopian, ETHIOPIAN_MONTH_NAMES_EN } from '@/lib/calendar'
import type { ISODate } from '@/lib/calendar'

interface Props {
  label: string
  name: string
  /** The academic year this date belongs to (AcademicYear.yearEc) — a
   *  school year never crosses an Ethiopian year boundary (Meskerem
   *  through Sene, all one E.C. year number), so every date field on the
   *  setup page shares this same fixed year rather than each having its
   *  own freely-typed one. That's what stops an admin from accidentally
   *  entering a date in the wrong Ethiopian year while setting up a
   *  specific year's calendar. */
  ethiopianYear: number
  /** Gregorian ISODate ('' / undefined for a not-yet-set, nullable field). */
  defaultValue?: string
}

interface EcParts {
  month: string
  day: string
}

function parseDefault(defaultValue?: string): EcParts {
  if (!defaultValue) return { month: '', day: '' }
  try {
    const ec = toEthiopian(defaultValue as ISODate)
    return { month: String(ec.month), day: String(ec.day) }
  } catch {
    // A malformed stored value shouldn't crash the form — just surface as
    // "not yet set" rather than taking the whole setup page down with it.
    return { month: '', day: '' }
  }
}

/**
 * Whether Pagumen (month 13) has 5 or 6 days in the given Ethiopian year.
 * Determined by round-tripping day 6 through the real converter rather than
 * hand-rolling Ethiopian leap-year math a second time — ethiopian-date.ts's
 * own "one authoritative conversion path, never reimplemented elsewhere"
 * rule applies to this input just as much as to the domain logic.
 */
function pagumenDayCount(ethiopianYear: number): 5 | 6 {
  try {
    const gc = fromEthiopian({ year: ethiopianYear, month: 13, day: 6 })
    const back = toEthiopian(gc)
    return back.year === ethiopianYear && back.month === 13 && back.day === 6 ? 6 : 5
  } catch {
    return 5
  }
}

function daysInEthiopianMonth(ethiopianYear: number, month: number): number {
  return month === 13 ? pagumenDayCount(ethiopianYear) : 30
}

/**
 * A date input the way K2 admins actually read Ministry plan documents —
 * Ethiopian year / month / day — instead of the browser's native Gregorian
 * date picker. Nobody using this form should ever have to convert a date by
 * hand before typing it in.
 *
 * The Gregorian ISODate the rest of the app runs on (API, database,
 * date-utils.ts) is still the only thing that ever leaves this component:
 * conversion happens locally via fromEthiopian(), and the result is
 * submitted through a hidden input under `name` — every existing
 * `new FormData(e.currentTarget).get(name)` call in SetupForm.tsx keeps
 * working completely unchanged.
 */
export function EthiopianDateField({ label, name, ethiopianYear, defaultValue }: Props) {
  const [parts, setParts] = useState<EcParts>(() => parseDefault(defaultValue))

  const maxDay = parts.month ? daysInEthiopianMonth(ethiopianYear, Number(parts.month)) : 30

  const gregorian = useMemo<ISODate | ''>(() => {
    if (!parts.month || !parts.day) return ''
    const m = Number(parts.month)
    const d = Number(parts.day)
    if (!Number.isInteger(m) || !Number.isInteger(d)) return ''
    if (d < 1 || d > daysInEthiopianMonth(ethiopianYear, m)) return ''
    try {
      return fromEthiopian({ year: ethiopianYear, month: m, day: d })
    } catch {
      return ''
    }
  }, [parts, ethiopianYear])

  function setMonth(month: string) {
    setParts((p) => {
      // Switching into/within Pagumen can shrink the valid day range (e.g.
      // day 6 stops existing outside a leap year) — drop a day that no
      // longer fits rather than silently keeping an invalid combination.
      const newMax = month ? daysInEthiopianMonth(ethiopianYear, Number(month)) : 30
      const day = p.day && Number(p.day) > newMax ? '' : p.day
      return { month, day }
    })
  }

  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <div className="flex items-center gap-1.5">
        <select
          aria-label={`${label} — month (E.C.)`}
          value={parts.month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Month</option>
          {ETHIOPIAN_MONTH_NAMES_EN.map((monthName, i) => (
            <option key={monthName} value={i + 1}>
              {monthName}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label} — day (E.C.)`}
          value={parts.day}
          onChange={(e) => setParts((p) => ({ ...p, day: e.target.value }))}
          className="w-[4.5rem] rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Day</option>
          {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {/* Not an input — deliberately locked. This is the fix for dates
            silently landing in the wrong Ethiopian year: there is no year
            field left to mistype. */}
        <span
          title="Locked to this academic year — a school year never crosses an Ethiopian year boundary"
          className="rounded-md border border-input bg-muted px-2 py-1.5 text-sm text-muted-foreground"
        >
          {ethiopianYear}
        </span>
      </div>
      <span className="text-[11px] text-muted-foreground/80">{gregorian ? `= ${gregorian} G.C.` : 'Enter a full Ethiopian date'}</span>
      <input type="hidden" name={name} value={gregorian} />
    </div>
  )
}
