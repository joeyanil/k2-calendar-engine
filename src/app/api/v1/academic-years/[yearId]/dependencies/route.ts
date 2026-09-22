import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { createDependency } from '@/lib/services/calendarDependency.service'

interface Params {
  params: Promise<{ yearId: string }>
}

export async function POST(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const body = await req.json()
    return ok(await createDependency(supabase, ctx, yearId, body), 201)
  })
}
