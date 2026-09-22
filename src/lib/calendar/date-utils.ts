/**
 * date-utils.ts
 *
 * The Calendar Engine's date-only arithmetic primitives.
 *
 * WHY THIS FILE EXISTS (see 03_Database_Design review + the five Deep Domain
 * files, File 3 §"Step 1 — Establish authoritative year boundaries"):
 *
 *   "The Calendar Engine must not accidentally shift a school date because of
 *    timezone conversion, UTC serialization, local midnight differences,
 *    daylight-saving behavior, or browser locale behavior."
 *
 * `new Date('2026-09-10')` and friends are exactly the kind of thing that
 * causes that class of bug — the same ISO string can resolve to a different
 * calendar day depending on the host's timezone. To make that class of bug
 * structurally impossible, this module never constructs a `Date` object for
 * arithmetic. Every calendar date is represented as:
 *
 *   1. An ISO string "YYYY-MM-DD" at rest (matches K2's Gregorian-ISO-8601
 *      storage/API convention, 02_Technology_Architecture.md), and
 *   2. A Julian Day Number (a plain integer) for every calculation —
 *      comparison, addition, subtraction, weekday, difference.
 *
 * `Date` objects are allowed ONLY at the presentation edge (e.g. handing a
 * value to `date-fns`'s `format()` for a UI label), and even then they are
 * constructed with `Date.UTC(...)` and read back with UTC getters only.
 *
 * This is the one authoritative Gregorian date-math module. Every other
 * Calendar Engine file imports from here rather than doing its own date
 * arithmetic (mirrors the "one authoritative conversion path" rule in
 * ethiopian-date.ts).
 */

/** A calendar date, always "YYYY-MM-DD", always Gregorian, always date-only. */
export type ISODate = string & { readonly __brand: 'ISODate' }

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export class InvalidCalendarDateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidCalendarDateError'
  }
}

export interface DateParts {
  year: number
  month: number // 1-12
  day: number // 1-31
}

/** Validates and brands a string as an ISODate. Throws on anything malformed
 *  or calendrically impossible (e.g. "2026-02-30"). */
export function isoDate(value: string): ISODate {
  const match = ISO_RE.exec(value)
  if (!match) {
    throw new InvalidCalendarDateError(
      `Expected an ISO date "YYYY-MM-DD", got: ${JSON.stringify(value)}`,
    )
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  assertValidGregorianParts({ year, month, day })
  // Re-serialize to guarantee a single canonical representation.
  return formatISO({ year, month, day })
}

export function isValidISODate(value: string): boolean {
  try {
    isoDate(value)
    return true
  } catch {
    return false
  }
}

function isLeapGregorianYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function daysInGregorianMonth(year: number, month: number): number {
  if (month === 2 && isLeapGregorianYear(year)) return 29
  const days = DAYS_IN_MONTH[month - 1]
  if (days === undefined) {
    throw new InvalidCalendarDateError(`Month out of range: ${month}`)
  }
  return days
}

function assertValidGregorianParts(parts: DateParts): void {
  const { year, month, day } = parts
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new InvalidCalendarDateError(`Date parts must be integers: ${JSON.stringify(parts)}`)
  }
  if (month < 1 || month > 12) {
    throw new InvalidCalendarDateError(`Month out of range 1-12: ${month}`)
  }
  const maxDay = daysInGregorianMonth(year, month)
  if (day < 1 || day > maxDay) {
    throw new InvalidCalendarDateError(
      `Day out of range for ${year}-${month}: got ${day}, max is ${maxDay}`,
    )
  }
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

export function formatISO(parts: DateParts): ISODate {
  assertValidGregorianParts(parts)
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}` as ISODate
}

export function parseISO(date: ISODate): DateParts {
  const match = ISO_RE.exec(date)
  if (!match) throw new InvalidCalendarDateError(`Malformed ISODate reached parseISO: ${date}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

/**
 * Gregorian calendar date -> Julian Day Number.
 * Fliegel & Van Flandern (1968) algorithm — pure integer math, no Date object,
 * proleptic-Gregorian, valid across the full range this system will ever see.
 */
export function toJDN(date: ISODate): number {
  const { year: y, month: m, day: d } = parseISO(date)
  const a = Math.floor((14 - m) / 12)
  const y2 = y + 4800 - a
  const m2 = m + 12 * a - 3
  return (
    d +
    Math.floor((153 * m2 + 2) / 5) +
    365 * y2 +
    Math.floor(y2 / 4) -
    Math.floor(y2 / 100) +
    Math.floor(y2 / 400) -
    32045
  )
}

/** Julian Day Number -> Gregorian calendar date. Inverse of {@link toJDN}. */
export function fromJDN(jdn: number): ISODate {
  const a = jdn + 32044
  const b = Math.floor((4 * a + 3) / 146097)
  const c = a - Math.floor((146097 * b) / 4)
  const d2 = Math.floor((4 * c + 3) / 1461)
  const e = c - Math.floor((1461 * d2) / 4)
  const m2 = Math.floor((5 * e + 2) / 153)
  const day = e - Math.floor((153 * m2 + 2) / 5) + 1
  const month = m2 + 3 - 12 * Math.floor(m2 / 10)
  const year = 100 * b + d2 - 4800 + Math.floor(m2 / 10)
  return formatISO({ year, month, day })
}

/** Adds `n` calendar days to a date (n may be negative). Never touches time-of-day
 *  or timezone, because there isn't one — it's pure integer JDN arithmetic. */
export function addDays(date: ISODate, n: number): ISODate {
  return fromJDN(toJDN(date) + n)
}

/** `differenceInCalendarDays(end, start)` — number of days from start to end. */
export function differenceInCalendarDays(end: ISODate, start: ISODate): number {
  return toJDN(end) - toJDN(start)
}

/** -1 if a < b, 0 if equal, 1 if a > b. */
export function compareISODate(a: ISODate, b: ISODate): -1 | 0 | 1 {
  const diff = toJDN(a) - toJDN(b)
  return diff < 0 ? -1 : diff > 0 ? 1 : 0
}

export function isBefore(a: ISODate, b: ISODate): boolean {
  return compareISODate(a, b) < 0
}
export function isAfter(a: ISODate, b: ISODate): boolean {
  return compareISODate(a, b) > 0
}
export function isSameOrBefore(a: ISODate, b: ISODate): boolean {
  return compareISODate(a, b) <= 0
}
export function isSameOrAfter(a: ISODate, b: ISODate): boolean {
  return compareISODate(a, b) >= 0
}

export function minISODate(a: ISODate, b: ISODate): ISODate {
  return isBefore(a, b) ? a : b
}
export function maxISODate(a: ISODate, b: ISODate): ISODate {
  return isAfter(a, b) ? a : b
}

/** Weekday index, 0 = Sunday ... 6 = Saturday (matches JS `Date#getDay()` and
 *  Kenat's `weekday()` convention, so no translation is needed at either
 *  boundary this system touches). Derived purely from the JDN. */
export function weekdayIndex(date: ISODate): number {
  // JDN 0 (Jan 1, 4713 BCE proleptic Julian) is known to be a Monday.
  // (jdn + 1) % 7 => 0 = Sunday, ... 6 = Saturday. Verified against known
  // reference dates in date-utils.test.ts (e.g. 2024-01-01 => Monday).
  const jdn = toJDN(date)
  return ((jdn + 1) % 7 + 7) % 7
}

export const WEEKDAY_NAMES = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
] as const
export type WeekdayName = (typeof WEEKDAY_NAMES)[number]

export function weekdayName(date: ISODate): WeekdayName {
  const idx = weekdayIndex(date)
  const name = WEEKDAY_NAMES[idx]
  if (!name) throw new InvalidCalendarDateError(`Impossible weekday index: ${idx}`)
  return name
}

/** The permanent K2 weekly pattern (mission item 7 / Deep Domain File 2 item 3):
 *  Saturday and Sunday are rest days; this is a fixed system rule, never a
 *  per-year configurable fact. */
export function isWeekend(date: ISODate): boolean {
  const idx = weekdayIndex(date)
  return idx === 0 || idx === 6 // Sunday or Saturday
}

export function isWeekday(date: ISODate): boolean {
  return !isWeekend(date)
}

/**
 * Generates every date in [start, end] inclusive, advancing exactly one
 * calendar day at a time (mission section 16, Step 3). Never skips, never
 * duplicates, never extends past `end`.
 */
export function* eachDayInclusive(start: ISODate, end: ISODate): Generator<ISODate> {
  const startJdn = toJDN(start)
  const endJdn = toJDN(end)
  for (let jdn = startJdn; jdn <= endJdn; jdn++) {
    yield fromJDN(jdn)
  }
}

/** Returns a real `Date` (UTC midnight) ONLY for handing off to a display/
 *  formatting library. Never use the result for calendar arithmetic. */
export function toDisplayUTCDate(date: ISODate): Date {
  const { year, month, day } = parseISO(date)
  return new Date(Date.UTC(year, month - 1, day))
}

/** The inverse of {@link toDisplayUTCDate} — reads a `Date` back using ONLY
 *  its UTC components, so a caller's local timezone can never shift the day. */
export function fromUTCDate(date: Date): ISODate {
  return formatISO({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  })
}
