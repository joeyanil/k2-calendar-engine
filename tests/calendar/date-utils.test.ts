import { describe, expect, it } from 'vitest'
import {
  addDays,
  compareISODate,
  differenceInCalendarDays,
  eachDayInclusive,
  fromJDN,
  isoDate,
  isValidISODate,
  isWeekend,
  toJDN,
  weekdayName,
} from '@/lib/calendar/date-utils'

describe('date-utils: ISO date validation', () => {
  it('accepts a well-formed date', () => {
    expect(isoDate('2026-09-10')).toBe('2026-09-10')
  })

  it('rejects a calendrically impossible date', () => {
    expect(() => isoDate('2026-02-30')).toThrow()
    expect(() => isoDate('2026-13-01')).toThrow()
    expect(() => isoDate('not-a-date')).toThrow()
  })

  it('correctly identifies a leap-year Feb 29', () => {
    expect(isValidISODate('2024-02-29')).toBe(true) // 2024 is a leap year
    expect(isValidISODate('2023-02-29')).toBe(false) // 2023 is not
    expect(isValidISODate('2000-02-29')).toBe(true) // divisible by 400
    expect(isValidISODate('1900-02-29')).toBe(false) // divisible by 100, not 400
  })
})

describe('date-utils: JDN round-trip', () => {
  it('round-trips an arbitrary set of dates through JDN and back', () => {
    const samples = ['2019-01-01', '2026-09-10', '2000-02-29', '1970-01-01', '2100-12-31']
    for (const s of samples) {
      const d = isoDate(s)
      expect(fromJDN(toJDN(d))).toBe(d)
    }
  })
})

describe('date-utils: weekday', () => {
  it('matches known real-world weekdays', () => {
    // 2024-01-01 was a Monday (verified against a real calendar).
    expect(weekdayName(isoDate('2024-01-01'))).toBe('MONDAY')
    // 2026-09-10 (this project's "today") was a Thursday.
    expect(weekdayName(isoDate('2026-09-10'))).toBe('THURSDAY')
    // 2000-01-01 was a Saturday.
    expect(weekdayName(isoDate('2000-01-01'))).toBe('SATURDAY')
  })

  it('flags Saturday and Sunday as weekend, nothing else', () => {
    // 2026-09-10 is a Thursday; the following Sat/Sun are the 12th/13th.
    expect(isWeekend(isoDate('2026-09-10'))).toBe(false)
    expect(isWeekend(isoDate('2026-09-11'))).toBe(false)
    expect(isWeekend(isoDate('2026-09-12'))).toBe(true)
    expect(isWeekend(isoDate('2026-09-13'))).toBe(true)
    expect(isWeekend(isoDate('2026-09-14'))).toBe(false)
  })
})

describe('date-utils: addDays / differenceInCalendarDays', () => {
  it('adds and subtracts days correctly across month/year boundaries', () => {
    expect(addDays(isoDate('2026-09-10'), 1)).toBe('2026-09-11')
    expect(addDays(isoDate('2026-12-31'), 1)).toBe('2027-01-01')
    expect(addDays(isoDate('2027-01-01'), -1)).toBe('2026-12-31')
    expect(addDays(isoDate('2024-02-28'), 1)).toBe('2024-02-29') // leap
    expect(addDays(isoDate('2023-02-28'), 1)).toBe('2023-03-01') // non-leap
  })

  it('computes calendar-day differences symmetrically', () => {
    const a = isoDate('2026-01-01')
    const b = isoDate('2026-12-31')
    expect(differenceInCalendarDays(b, a)).toBe(364) // 2026 is not a leap year
    expect(differenceInCalendarDays(a, b)).toBe(-364)
    expect(differenceInCalendarDays(a, a)).toBe(0)
  })
})

describe('date-utils: compareISODate', () => {
  it('orders dates correctly', () => {
    expect(compareISODate(isoDate('2026-01-01'), isoDate('2026-01-02'))).toBe(-1)
    expect(compareISODate(isoDate('2026-01-02'), isoDate('2026-01-01'))).toBe(1)
    expect(compareISODate(isoDate('2026-01-01'), isoDate('2026-01-01'))).toBe(0)
  })
})

describe('date-utils: eachDayInclusive', () => {
  it('generates every date exactly once, in order, first-to-last inclusive', () => {
    const start = isoDate('2026-09-10')
    const end = isoDate('2026-09-15')
    const days = [...eachDayInclusive(start, end)]
    expect(days).toEqual([
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
    ])
  })

  it('handles a single-day range', () => {
    const d = isoDate('2026-09-10')
    expect([...eachDayInclusive(d, d)]).toEqual(['2026-09-10'])
  })

  it('never skips a day across a leap-year February', () => {
    const days = [...eachDayInclusive(isoDate('2024-02-27'), isoDate('2024-03-01'))]
    expect(days).toEqual(['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01'])
  })
})
