import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { createAcademicYear, listAcademicYears } from '@/lib/services/academicYear.service'

export async function GET() {
  return handleRoute(async () => {
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const years = await listAcademicYears(supabase, ctx)
    return ok(years)
  })
}

export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const body = await req.json()
    const year = await createAcademicYear(supabase, ctx, body)
    return ok(year, 201)
  })
}
