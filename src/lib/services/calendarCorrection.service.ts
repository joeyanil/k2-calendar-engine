import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/types/database.types'
import { AppError } from '../errors/AppError'
import { can } from '../permissions/engine'
import type { AuthContext } from '../auth/withAuth'
import { isoDateSchema } from './validators'

export const applyCorrectionSchema = z.object({
  factKind: z.enum([
    'ACADEMIC_YEAR_START',
    'ACADEMIC_YEAR_END',
    'SEMESTER_START',
    'SEMESTER_END',
    'HOLIDAY_OCCURRENCE',
    'EXAM_START',
    'EXAM_END',
    'STUDENT_RETURN',
  ]),
  factSemesterOrder: z.union([z.literal(1), z.literal(2)]).nullable().default(null),
  factHolidayTypeKey: z.string().nullable().default(null),
  factExamTypeKey: z.string().nullable().default(null),
  correctedValue: isoDateSchema,
  reason: z.string().min(1, 'A reason is required for every formal correction.'),
})

/**
 * The ONLY path that can change a date fact belonging to a CLOSED year or
 * semester (mission §37). Requires `calendar.correct_history` — a
 * genuinely stronger permission than ordinary `calendar.manage` — and
 * writes an immutable correction record via `fn_apply_calendar_correction`
 * (Migration 0013).
 *
 * Deliberately does NOT rebuild the timeline itself — call
 * `rebuildAndPublishTimeline` afterward as an explicit next step so the two
 * operations (correcting a fact, republishing a timeline) stay individually
 * inspectable rather than being bundled into one opaque action.
 */
export async function applyCalendarCorrection(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  input: z.infer<typeof applyCorrectionSchema>,
) {
  if (!can(ctx, 'calendar.correct_history')) throw new AppError('FORBIDDEN', 403)
  const parsed = applyCorrectionSchema.parse(input)

  const { data, error } = await supabase.rpc('fn_apply_calendar_correction', {
    p_academic_year_id: academicYearId,
    p_fact_kind: parsed.factKind,
    p_fact_semester_order: parsed.factSemesterOrder,
    p_fact_holiday_type_key: parsed.factHolidayTypeKey as never,
    p_fact_exam_type_key: parsed.factExamTypeKey as never,
    p_corrected_value: parsed.correctedValue,
    p_reason: parsed.reason,
  })

  if (error) {
    if (error.hint === 'CALENDAR_CORRECTION_REQUIRES_CLOSED_SCOPE') {
      throw new AppError('CALENDAR_CORRECTION_REQUIRES_CLOSED_SCOPE', 422, error.message)
    }
    throw new AppError('CALENDAR_CORRECTION_FAILED', 500, error.message)
  }
  return data
}

export async function listCorrections(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
) {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  const { data, error } = await supabase
    .from('calendar_corrections')
    .select()
    .eq('academic_year_id', academicYearId)
    .order('performed_at', { ascending: false })
  if (error) throw new AppError('CALENDAR_LIST_FAILED', 500, error.message)
  return data ?? []
}
