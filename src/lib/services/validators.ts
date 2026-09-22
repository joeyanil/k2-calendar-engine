/**
 * validators.ts — shared, reusable zod schemas for the service layer.
 *
 * Fix #19 (v2 repair guide): "Some request schemas validate only YYYY-MM-DD.
 * That is a format check, not a date-validity check... 2026-02-30 must fail
 * as invalid input before it becomes a confusing database/server error...
 * Do not duplicate different date validation implementations."
 *
 * `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` — the pattern every service
 * used before this file existed — happily accepts `2026-02-30` or
 * `2026-13-45`; it was purely a shape check. `isoDateSchema` below is a
 * thin zod wrapper around the domain layer's own `isValidISODate`
 * (date-utils.ts), which does real Gregorian calendar-validity checking
 * (leap years, days-per-month, the works) — so every service imports this
 * ONE schema rather than each hand-rolling its own, which is exactly what
 * let the weak version spread to seven different files in the first place.
 */
import { z } from 'zod'
import { isValidISODate } from '../calendar'

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(isValidISODate, (value) => ({ message: `"${value}" is not a valid calendar date` }))
