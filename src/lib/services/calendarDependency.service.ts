import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/types/database.types'
import { AppError } from '../errors/AppError'
import { can } from '../permissions/engine'
import type { AuthContext } from '../auth/withAuth'
import { isoDateSchema } from './validators'
import {
  assertNoCycle,
  assertNoConflictingIncomingRules,
  factMapFromConfiguration,
  factRefKey,
  previewDependencyImpact,
  resolveCalendarConfiguration,
  FIXED_HOLIDAY_KEYS,
  MOVABLE_HOLIDAY_KEYS,
  STANDARD_EXAM_KEYS,
  GRADE12_EXAM_KEY,
  type CalendarFactRef,
  type DependencyRule,
  type HolidayTypeKey,
  type ExamTypeKey,
  type ISODate,
} from '../calendar'
import { buildFactRef } from './calendarValidation.service'
import { loadConfiguration } from './calendarTimeline.service'

/**
 * Fix #21: a real discriminated union, not a permissive shape relying on
 * `.optional()` for every companion field. The old schema accepted
 * `{ kind: 'SEMESTER_START' }` with no order, or `{ kind:
 * 'HOLIDAY_OCCURRENCE', holidayTypeKey: 'anything' }` — this one can't:
 * each kind requires exactly its own companion field, using the real
 * 9-holiday / 5-exam catalogs, and rejects every other kind's field
 * (z.object is exact here — no `.passthrough()`). This is also what lets
 * factRefToColumns below drop every `as never` cast it used to need: the
 * input is now actually shaped like CalendarFactRef, not merely typed as
 * one by assertion.
 */
const semesterOrderSchema = z.union([z.literal(1), z.literal(2)])
const holidayTypeKeySchema = z.enum([...FIXED_HOLIDAY_KEYS, ...MOVABLE_HOLIDAY_KEYS] as [HolidayTypeKey, ...HolidayTypeKey[]])
const examTypeKeySchema = z.enum([...STANDARD_EXAM_KEYS, GRADE12_EXAM_KEY] as [ExamTypeKey, ...ExamTypeKey[]])

const factRefSchema: z.ZodType<CalendarFactRef> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ACADEMIC_YEAR_START') }).strict(),
  z.object({ kind: z.literal('ACADEMIC_YEAR_END') }).strict(),
  z.object({ kind: z.literal('SEMESTER_START'), order: semesterOrderSchema }).strict(),
  z.object({ kind: z.literal('SEMESTER_END'), order: semesterOrderSchema }).strict(),
  z.object({ kind: z.literal('HOLIDAY_OCCURRENCE'), holidayTypeKey: holidayTypeKeySchema }).strict(),
  z.object({ kind: z.literal('EXAM_START'), examTypeKey: examTypeKeySchema }).strict(),
  z.object({ kind: z.literal('EXAM_END'), examTypeKey: examTypeKeySchema }).strict(),
  z.object({ kind: z.literal('STUDENT_RETURN') }).strict(),
])

export const createDependencySchema = z.object({
  anchor: factRefSchema,
  dependent: factRefSchema,
  offsetDays: z.number().int(),
})

function factRefToColumns(ref: CalendarFactRef) {
  return {
    kind: ref.kind,
    semesterOrder: 'order' in ref ? ref.order : null,
    holidayTypeKey: 'holidayTypeKey' in ref ? ref.holidayTypeKey : null,
    examTypeKey: 'examTypeKey' in ref ? ref.examTypeKey : null,
  }
}

async function loadActiveRules(supabase: SupabaseClient<Database>, academicYearId: string): Promise<DependencyRule[]> {
  const { data } = await supabase.from('calendar_dependencies').select().eq('academic_year_id', academicYearId).eq('active', true)
  return (data ?? []).map((d) => ({
    id: d.id,
    academicYearId: d.academic_year_id,
    anchor: buildFactRef(d.anchor_kind, d.anchor_semester_order, d.anchor_holiday_type_key, d.anchor_exam_type_key),
    dependent: buildFactRef(d.dependent_kind, d.dependent_semester_order, d.dependent_holiday_type_key, d.dependent_exam_type_key),
    offsetDays: d.offset_days,
    active: d.active,
    createdByUserId: d.created_by,
    createdAt: d.created_at,
  }))
}

/** Creates a DEPENDENT relationship, after re-running the same cycle check
 *  the database trigger (Migration 0007) will also run — fail with a clean
 *  AppError before ever reaching the database, rather than surfacing a raw
 *  Postgres exception to the caller. */
export async function createDependency(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  input: z.infer<typeof createDependencySchema>,
) {
  if (!can(ctx, 'calendar.manage_dependencies')) throw new AppError('FORBIDDEN', 403)
  const { anchor, dependent, offsetDays } = createDependencySchema.parse(input)

  const existingRules = await loadActiveRules(supabase, academicYearId)
  const candidateRule: DependencyRule = {
    id: '',
    academicYearId,
    anchor,
    dependent,
    offsetDays,
    active: true,
    createdByUserId: ctx.user.id,
    createdAt: new Date().toISOString(),
  }
  assertNoCycle(existingRules, candidateRule)
  assertNoConflictingIncomingRules([...existingRules, candidateRule])

  const a = factRefToColumns(anchor)
  const d = factRefToColumns(dependent)

  const { data, error } = await supabase
    .from('calendar_dependencies')
    .insert({
      academic_year_id: academicYearId,
      anchor_kind: a.kind,
      anchor_semester_order: a.semesterOrder as never,
      anchor_holiday_type_key: a.holidayTypeKey as never,
      anchor_exam_type_key: a.examTypeKey as never,
      dependent_kind: d.kind,
      dependent_semester_order: d.semesterOrder as never,
      dependent_holiday_type_key: d.holidayTypeKey as never,
      dependent_exam_type_key: d.examTypeKey as never,
      offset_days: offsetDays,
      created_by: ctx.user.id,
    })
    .select()
    .single()

  if (error) {
    if (error.hint === 'CALENDAR_CIRCULAR_DEPENDENCY') throw new AppError('CALENDAR_CIRCULAR_DEPENDENCY', 422, error.message)
    if (error.hint === 'CALENDAR_CONFLICTING_DEPENDENCY') throw new AppError('CALENDAR_CONFLICTING_DEPENDENCY', 422, error.message)
    throw new AppError('CALENDAR_CREATE_FAILED', 500, error.message)
  }
  return data
}

export const previewImpactSchema = z.object({
  changedFact: factRefSchema,
  newDate: isoDateSchema,
})

/** Shows what would move, and by how much, before a change to an anchor
 *  fact is actually accepted (mission §34). Read-only — applies nothing.
 *  Uses the year's REAL current resolved facts (loaded and resolved
 *  exactly the way the build pipeline does) so `oldDate` in the response
 *  is genuine, not always-undefined. */
export async function previewDependencyChangeImpact(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  input: z.infer<typeof previewImpactSchema>,
) {
  if (!can(ctx, 'calendar.manage_dependencies')) throw new AppError('FORBIDDEN', 403)
  const { changedFact, newDate } = previewImpactSchema.parse(input)

  const { config, dependencyRules } = await loadConfiguration(supabase, academicYearId)
  const resolvedConfig = resolveCalendarConfiguration(config, dependencyRules)
  const resolvedFacts = factMapFromConfiguration(resolvedConfig)

  return previewDependencyImpact(changedFact, newDate as ISODate, dependencyRules, resolvedFacts)
}

/** Fix #13: "do not invent a second user-editable date that silently
 *  overrides the dependency." Resolution (dependencyResolution.ts) always
 *  uses the anchor-derived value for a fact with an active incoming rule —
 *  never the fact's own stored column. Without this guard, an admin could
 *  edit that column, see it save successfully, and never learn their edit
 *  has zero effect once a build runs. Every ordinary date-setting service
 *  function calls this first; the only way to change such a fact's date is
 *  to edit the dependency (its offset or its anchor) or remove it. */
export async function assertFactNotGovernedByDependency(
  supabase: SupabaseClient<Database>,
  academicYearId: string,
  fact: CalendarFactRef,
): Promise<void> {
  const rules = await loadActiveRules(supabase, academicYearId)
  const governingRule = rules.find((r) => factRefKey(r.dependent) === factRefKey(fact))
  if (governingRule) {
    throw new AppError(
      'CALENDAR_FACT_GOVERNED_BY_DEPENDENCY',
      409,
      `"${factRefKey(fact)}" is governed by an active dependency on "${factRefKey(governingRule.anchor)}" (offset ${governingRule.offsetDays} day(s)) and cannot be edited directly. Edit or remove the dependency instead.`,
    )
  }
}
