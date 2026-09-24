'use client'

import { useRouter } from 'next/navigation'
import type { AcademicYear } from '@/lib/calendar'

/**
 * Lets an admin jump between already-created academic years' own Setup
 * pages, instead of backing all the way out to the overview each time.
 *
 * This does NOT make a year's own Ethiopian year number editable —
 * AcademicYear.yearEc stays exactly what it was ("derived at creation,
 * never independently editable", types.ts) on every record. Picking "2020"
 * here just navigates to *2020's own* /calendar/[yearId]/setup — a
 * different record, already locked to 2020 the same way this one is
 * locked to whatever year it belongs to.
 */
export function YearSwitcher({ years, currentYearId }: { years: AcademicYear[]; currentYearId: string }) {
  const router = useRouter()

  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>Year</span>
      <select
        aria-label="Switch academic year"
        value={currentYearId}
        onChange={(e) => router.push(`/calendar/${e.target.value}/setup`)}
        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {years.map((y) => (
          <option key={y.id} value={y.id}>
            {y.name}
          </option>
        ))}
      </select>
    </label>
  )
}
