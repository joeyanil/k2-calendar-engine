import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { getCurrentTimeline } from '@/lib/services/calendarTimeline.service'

interface Params {
  params: Promise<{ yearId: string }>
}

export async function GET(_req: Request, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await getCurrentTimeline(supabase, ctx, yearId))
  })
}
