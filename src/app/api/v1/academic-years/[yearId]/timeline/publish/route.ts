import type { NextRequest } from 'next/server'
import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { publishTimelineBuild } from '@/lib/services/calendarTimeline.service'

/** Body: `{ "buildId": "..." }`. Promotes a CANDIDATE to CURRENT atomically
 *  via fn_publish_calendar_timeline — rejects a stale build (409) rather
 *  than overwriting a newer one (mission §30). */
export async function POST(req: NextRequest) {
  return handleRoute(async () => {
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const body = await req.json().catch(() => ({}))
    await publishTimelineBuild(supabase, ctx, body)
    return ok({ published: true })
  })
}
