import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { AppError } from '@/lib/errors/AppError'
import { getDay } from '@/lib/services/calendarTimeline.service'
import { isValidISODate, type ISODate } from '@/lib/calendar'

interface Params {
  params: Promise<{ yearId: string }>
}

/** `GET .../timeline/day?date=2026-11-17` — one authoritative date's
 *  complete state (mission §24's Day view). */
export async function GET(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const date = req.nextUrl.searchParams.get('date')
    if (!date) throw new AppError('VALIDATION_ERROR', 422, 'Query parameter "date" is required.')
    if (!isValidISODate(date)) {
      throw new AppError('VALIDATION_ERROR', 422, `Query parameter "date" is not a valid calendar date: "${date}".`)
    }
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await getDay(supabase, ctx, yearId, date as ISODate))
  })
}
