import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { AppError } from '@/lib/errors/AppError'
import { toggleHolidayClosure } from '@/lib/services/holiday.service'
import { FIXED_HOLIDAY_KEYS, MOVABLE_HOLIDAY_KEYS, type HolidayTypeKey } from '@/lib/calendar'

const HOLIDAY_TYPE_KEYS: readonly string[] = [...FIXED_HOLIDAY_KEYS, ...MOVABLE_HOLIDAY_KEYS]

interface Params {
  params: Promise<{ yearId: string; key: string }>
}

/** Validates the raw path segment against the real 9-key catalog before it
 *  ever reaches a query — a malformed/garbage key must fail as a clean 422,
 *  not as a raw Postgres "invalid input value for enum" 500. */
function parseHolidayTypeKey(raw: string): HolidayTypeKey {
  if (HOLIDAY_TYPE_KEYS.includes(raw)) return raw as HolidayTypeKey
  throw new AppError('VALIDATION_ERROR', 422, `Unknown holiday type key in path: "${raw}".`)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId, key } = await params
    const holidayTypeKey = parseHolidayTypeKey(key)
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const body = await req.json()
    return ok(await toggleHolidayClosure(supabase, ctx, yearId, holidayTypeKey, body))
  })
}
