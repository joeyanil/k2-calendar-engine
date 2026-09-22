import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { transitionSemesterStatus } from '@/lib/services/semester.service'

interface Params {
  params: Promise<{ semesterId: string }>
}

/** Body: `{ "to": "ACTIVE" | "CLOSED" }`. No unlock endpoint exists
 *  anywhere — CLOSED is permanent (mission §36). */
export async function POST(req: NextRequest, { params }: Params) {
  return handleRoute(async () => {
    const { semesterId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const body = await req.json().catch(() => ({}))
    return ok(await transitionSemesterStatus(supabase, ctx, semesterId, body))
  })
}
