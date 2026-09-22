import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { AppError } from '@/lib/errors/AppError'
import { setSemesterDates } from '@/lib/services/semester.service'
import type { SemesterOrder } from '@/lib/calendar'

interface Params {
  params: Promise<{ yearId: string; order: string }>
}

/** Only '1' and '2' are ever legal — a semester order is not a free-form
 *  path segment. Anything else (a typo, '0', '3', a non-numeric string)
 *  must fail loudly with a 422, never silently resolve to a semester the
 *  caller didn't ask for. */
function parseSemesterOrder(raw: string): SemesterOrder {
  if (raw === '1') return 1
  if (raw === '2') return 2
  throw new AppError(
    'VALIDATION_ERROR',
    422,
    `Invalid semester order in path: "${raw}". Only "1" or "2" are valid.`,
  )
}

export async function PATCH(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId, order } = await params
    const semOrder = parseSemesterOrder(order)
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const body = await req.json()
    return ok(await setSemesterDates(supabase, ctx, yearId, semOrder, body))
  })
}
