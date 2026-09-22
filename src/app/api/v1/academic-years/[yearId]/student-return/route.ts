import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { getStudentReturn, setStudentReturn } from '@/lib/services/studentReturn.service'

interface Params {
  params: Promise<{ yearId: string }>
}

export async function GET(_req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await getStudentReturn(supabase, ctx, yearId))
  })
}

export async function PUT(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const body = await req.json()
    return ok(await setStudentReturn(supabase, ctx, yearId, body))
  })
}
