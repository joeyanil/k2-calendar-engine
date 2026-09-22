import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { listExamInstances, setExamInstance } from '@/lib/services/exam.service'

interface Params {
  params: Promise<{ yearId: string }>
}

export async function GET(_req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await listExamInstances(supabase, ctx, yearId))
  })
}

/** Creates or updates one exam's dates. Rejects the two hard stops
 *  (weekend, closing-holiday overlap) outright — see exam.service.ts. */
export async function PUT(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const body = await req.json()
    return ok(await setExamInstance(supabase, ctx, yearId, body))
  })
}
