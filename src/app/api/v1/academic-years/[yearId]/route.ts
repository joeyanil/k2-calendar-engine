import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { getAcademicYear, updateAcademicYearBoundary } from '@/lib/services/academicYear.service'

interface Params {
  params: Promise<{ yearId: string }>
}

export async function GET(_req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await getAcademicYear(supabase, ctx, yearId))
  })
}

/** Replaces the default Meskerem-5 -> Sene-30 boundary with the real
 *  Ministry-plan dates (mission §5, §41 step 3). */
export async function PATCH(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const body = await req.json()
    return ok(await updateAcademicYearBoundary(supabase, ctx, yearId, body))
  })
}
