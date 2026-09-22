import { handleRoute, ok } from '@/lib/api/respond'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { AppError } from '@/lib/errors/AppError'
import { deleteExamInstance } from '@/lib/services/exam.service'
import { STANDARD_EXAM_KEYS, GRADE12_EXAM_KEY, type ExamTypeKey } from '@/lib/calendar'

const EXAM_TYPE_KEYS: readonly string[] = [...STANDARD_EXAM_KEYS, GRADE12_EXAM_KEY]

interface Params {
  params: Promise<{ yearId: string; key: string }>
}

/** Validates the raw path segment against the real 5-key catalog before it
 *  ever reaches a query — see holidays/[key]/route.ts for the same fix and
 *  rationale. */
function parseExamTypeKey(raw: string): ExamTypeKey {
  if (EXAM_TYPE_KEYS.includes(raw)) return raw as ExamTypeKey
  throw new AppError('VALIDATION_ERROR', 422, `Unknown exam type key in path: "${raw}".`)
}

export async function DELETE(_req: Request, { params }: Params) {
  return handleRoute(async () => {
    const { yearId, key } = await params
    const examTypeKey = parseExamTypeKey(key)
    const ctx = await withAuth()
    const supabase = await createServerClient()
    await deleteExamInstance(supabase, ctx, yearId, examTypeKey)
    return ok({ deleted: true })
  })
}
