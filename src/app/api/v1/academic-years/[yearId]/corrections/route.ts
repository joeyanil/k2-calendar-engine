import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { applyCalendarCorrection, listCorrections } from '@/lib/services/calendarCorrection.service'

interface Params {
  params: Promise<{ yearId: string }>
}

export async function GET(_req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await listCorrections(supabase, ctx, yearId))
  })
}

/** Requires `calendar.correct_history` — the only path past a CLOSED
 *  year/semester (mission §37). */
export async function POST(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const body = await req.json()
    return ok(await applyCalendarCorrection(supabase, ctx, yearId, body), 201)
  })
}
