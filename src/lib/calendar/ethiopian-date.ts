/**
 * ethiopian-date.ts
 *
 * The ONE authoritative Ethiopian <-> Gregorian conversion path for the whole
 * Calendar Engine (mission section 17 / Deep Domain File 3 §N: "the Calendar
 * Engine must have one authoritative conversion path... never allow the UI,
 * database queries, the API, or reporting to each independently implement
 * Ethiopian date arithmetic").
 *
 * Every other Calendar Engine module that needs an Ethiopian date imports
 * from here — never from `kenat` directly, and never from `date-fns` for
 * Ethiopian math (date-fns only ever touches the Gregorian side, per
 * 02_Technology_Architecture.md's locked "Calendar strategy" note).
 *
 * `kenat`'s `toEC`/`toGC` are plain (number,number,number) -> {year,month,day}
 * functions with no `Date` object involved anywhere, so they carry none of
 * the timezone risk `date-utils.ts` guards against on the Gregorian side.
 *
 * IMPORTANT — what this module deliberately does NOT use:
 * `kenat` ships a full Bahire Hasab / holiday calculation engine
 * (`getHolidaysForYear`, `getBahireHasab`, etc.). The Calendar Engine's
 * holiday model (holidays.ts) MUST NOT call any of it for the four movable
 * holidays (Siklet, Fasika, Eid al-Fitr, Eid al-Adha) — mission section 8 /
 * Deep Domain File 2 item 5 is explicit that the engine "calculates none of
 * them, for any of the four," and File 2 §F names `seedNationalHolidays()`'s
 * Bahire-Hasab auto-calculation as a legacy behavior that must be removed,
 * not reused. Only the pure date-conversion utilities below are used.
 */
import { toEC, toGC } from 'kenat'
import type { ISODate } from './date-utils'
import { formatISO, isoDate } from './date-utils'

export interface EthiopianDateParts {
  year: number
  month: number // 1-13 (Pagumen is month 13)
  day: number
}

export const ETHIOPIAN_MONTH_NAMES_EN = [
  'Meskerem',
  'Tikimt',
  'Hidar',
  'Tahsas',
  'Tir',
  'Yekatit',
  'Megabit',
  'Miazia',
  'Ginbot',
  'Sene',
  'Hamle',
  'Nehase',
  'Pagumen',
] as const

/** Converts a Gregorian ISODate to its Ethiopian calendar representation. */
export function toEthiopian(date: ISODate): EthiopianDateParts {
  const [year, month, day] = isoDate(date).split('-').map(Number) as [number, number, number]
  const ethiopian = toEC(year, month, day)
  return { year: ethiopian.year, month: ethiopian.month, day: ethiopian.day }
}

/** Converts an Ethiopian calendar date to its Gregorian ISODate representation. */
export function fromEthiopian(parts: EthiopianDateParts): ISODate {
  const gregorian = toGC(parts.year, parts.month, parts.day)
  return formatISO({ year: gregorian.year, month: gregorian.month, day: gregorian.day })
}

/** Builds a Gregorian ISODate directly from Ethiopian year/month/day literals —
 *  the everyday convenience path for describing a fixed Ethiopian-calendar
 *  date (e.g. holiday definitions) without hand-rolling the object literal. */
export function ethiopianDate(year: number, month: number, day: number): ISODate {
  return fromEthiopian({ year, month, day })
}

/** Human-readable Ethiopian label, e.g. "Meskerem 5, 2019". English-only,
 *  matching K2's locked UI-language decision (02_Technology_Architecture.md). */
export function formatEthiopian(date: ISODate): string {
  const { year, month, day } = toEthiopian(date)
  const name = ETHIOPIAN_MONTH_NAMES_EN[month - 1] ?? `Month ${month}`
  return `${name} ${day}, ${year}`
}

/** Given an Ethiopian year number (e.g. 2019), returns the Gregorian ISODate
 *  for a fixed Meskerem-based day within it — the building block every fixed
 *  holiday and the default year-boundary calculation is built from. */
export function ethiopianYearDate(ethiopianYear: number, month: number, day: number): ISODate {
  return ethiopianDate(ethiopianYear, month, day)
}
