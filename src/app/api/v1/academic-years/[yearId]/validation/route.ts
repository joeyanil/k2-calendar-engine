import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { runCalendarValidation } from '@/lib/services/calendarValidation.service'
import { summarizeValidation } from '@/lib/calendar'

interface Params {
  params: Promise<{ yearId: string }>
}

export async function GET(_req: Request, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const issues = await runCalendarValidation(supabase, ctx, yearId)
    return ok({ issues, summary: summarizeValidation(issues) })
  })
}
