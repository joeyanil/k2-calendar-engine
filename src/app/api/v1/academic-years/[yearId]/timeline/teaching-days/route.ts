import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { AppError } from '@/lib/errors/AppError'
import { getTeachingDaySummary } from '@/lib/services/calendarTimeline.service'
import { isValidISODate, type ISODate } from '@/lib/calendar'

interface Params {
  params: Promise<{ yearId: string }>
}

/** `GET .../timeline/teaching-days?start=2026-09-11&end=2027-07-08` — works
 *  identically for a whole year, a semester, or any arbitrary range
 *  (mission §22). */
export async function GET(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const start = req.nextUrl.searchParams.get('start')
    const end = req.nextUrl.searchParams.get('end')
    if (!start || !end) throw new AppError('VALIDATION_ERROR', 422, 'Query parameters "start" and "end" are required.')
    if (!isValidISODate(start)) throw new AppError('VALIDATION_ERROR', 422, `"start" is not a valid calendar date: "${start}".`)
    if (!isValidISODate(end)) throw new AppError('VALIDATION_ERROR', 422, `"end" is not a valid calendar date: "${end}".`)
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await getTeachingDaySummary(supabase, ctx, yearId, start as ISODate, end as ISODate))
  })
}
