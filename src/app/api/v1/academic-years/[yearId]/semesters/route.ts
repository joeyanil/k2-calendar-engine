import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { listSemesters } from '@/lib/services/semester.service'

interface Params {
  params: Promise<{ yearId: string }>
}

export async function GET(_req: Request, { params }: Params) {
  return handleRoute(async () => {
    const { yearId } = await params
    const ctx = await withAuth()
    const supabase = await createServerClient()
    return ok(await listSemesters(supabase, ctx, yearId))
  })
}
