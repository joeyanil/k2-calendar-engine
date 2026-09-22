import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { transitionAcademicYearStatus } from '@/lib/services/academicYear.service'

interface Params {
  params: Promise<{ yearId: string }>
}

/** Body: `{ "to": "READY" | "ACTIVE" | "CLOSED" }` — advances exactly one
 *  legal step (mission §5's PREPARING -> READY -> ACTIVE -> CLOSED). */
export async function POST(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const body = await req.json().catch(() => ({}))
    return ok(await transitionAcademicYearStatus(supabase, ctx, yearId, body))
  })
}
