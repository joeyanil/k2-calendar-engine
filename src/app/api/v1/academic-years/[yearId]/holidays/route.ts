import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { enterMovableHoliday, listHolidayOccurrences, seedFixedHolidays } from '@/lib/services/holiday.service'
import { getAcademicYear } from '@/lib/services/academicYear.service'

interface Params {
  params: Promise<{ yearId: string }>
}

export async function GET(_req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await listHolidayOccurrences(supabase, ctx, yearId))
  })
}

/**
 * Body shape decides the action, since holidays are configured two very
 * different ways (mission §8):
 *   `{ "action": "seed_fixed" }` — auto-proposes the five fixed holidays.
 *   `{ "action": "enter_movable", "holidayTypeKey", "date", "closesSchool" }`
 *   — records an admin-confirmed movable holiday date. There is no third
 *   action that calculates a movable date; that branch doesn't exist.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const body = await req.json()

    if (body.action === 'seed_fixed') {
      const year = await getAcademicYear(supabase, ctx, yearId)
      return ok(await seedFixedHolidays(supabase, ctx, yearId, year.yearEc))
    }

    const year = await getAcademicYear(supabase, ctx, yearId)
    return ok(await enterMovableHoliday(supabase, ctx, yearId, body, year.yearEc), 201)
  })
}
