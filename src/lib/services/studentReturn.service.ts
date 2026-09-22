import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/types/database.types'
import { AppError } from '../errors/AppError'
import { can } from '../permissions/engine'
import type { AuthContext } from '../auth/withAuth'
import { isoDateSchema } from './validators'
import type { StudentReturnDay } from '../calendar'
import { assertFactNotGovernedByDependency } from './calendarDependency.service'

export const setStudentReturnSchema = z.object({ date: isoDateSchema })

export async function getStudentReturn(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
): Promise<StudentReturnDay | null> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  const { data, error } = await supabase
    .from('student_return_days')
    .select()
    .eq('academic_year_id', academicYearId)
    .maybeSingle()
  if (error) throw new AppError('CALENDAR_LIST_FAILED', 500, error.message)
  if (!data) return null
  return { id: data.id, academicYearId: data.academic_year_id, date: data.date as never }
}

/** Student Return is its own first-class fact (mission §10) — never a row
 *  in a generic events table. Exactly one per year, enforced by the
 *  `student_return_days.academic_year_id UNIQUE` constraint. */
export async function setStudentReturn(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  input: z.infer<typeof setStudentReturnSchema>,
): Promise<StudentReturnDay> {
  if (!can(ctx, 'calendar.manage')) throw new AppError('FORBIDDEN', 403)
  const { date } = setStudentReturnSchema.parse(input)

  await assertFactNotGovernedByDependency(supabase, academicYearId, { kind: 'STUDENT_RETURN' })

  const { data, error } = await supabase
    .from('student_return_days')
    .upsert({ academic_year_id: academicYearId, date }, { onConflict: 'academic_year_id' })
    .select()
    .single()

  if (error) throw new AppError('CALENDAR_CREATE_FAILED', 500, error.message)
  return { id: data.id, academicYearId: data.academic_year_id, date: data.date as never }
}
