import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { AppError } from '@/lib/errors/AppError'
import { confirmFixedHoliday } from '@/lib/services/holiday.service'
import { FIXED_HOLIDAY_KEYS, type HolidayTypeKey } from '@/lib/calendar'

interface Params {
  params: Promise<{ yearId: string; key: string }>
}

/** Only the 5 fixed keys are valid here — same validated-path-segment
 *  pattern as holidays/[key]/route.ts, narrowed to fixed holidays since
 *  this endpoint exists specifically for their propose -> confirm workflow
 *  (fix #17). */
function parseFixedHolidayTypeKey(raw: string): HolidayTypeKey {
  if ((FIXED_HOLIDAY_KEYS as readonly string[]).includes(raw)) return raw as HolidayTypeKey
  throw new AppError('VALIDATION_ERROR', 422, `"${raw}" is not a fixed holiday key.`)
}

/** `POST .../holidays/:key/confirm` — the admin reviewing and confirming a
 *  fixed holiday's auto-proposed occurrence (mission §8, fix #17). */
export async function POST(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId, key } = await params
    const holidayTypeKey = parseFixedHolidayTypeKey(key)
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const body = await req.json().catch(() => ({}))
    return ok(await confirmFixedHoliday(supabase, ctx, yearId, holidayTypeKey, body))
  })
}
