import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { buildCandidateTimeline } from '@/lib/services/calendarTimeline.service'

interface Params {
  params: Promise<{ yearId: string }>
}

/** Builds (but does not publish) a new CANDIDATE timeline from the year's
 *  current configuration (mission §29 Steps 1-5). */
export async function POST(_req: Request, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await buildCandidateTimeline(supabase, ctx, yearId), 201)
  })
}
