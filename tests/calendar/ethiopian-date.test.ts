import { describe, expect, it } from 'vitest'
import { isoDate } from '@/lib/calendar/date-utils'
import {
  ethiopianDate,
  formatEthiopian,
  fromEthiopian,
  toEthiopian,
} from '@/lib/calendar/ethiopian-date'

describe('ethiopian-date: conversion round-trip', () => {
  it('round-trips Gregorian -> Ethiopian -> Gregorian', () => {
    const samples = ['2026-09-10', '2019-01-01', '2000-06-15', '2027-07-08']
    for (const s of samples) {
      const g = isoDate(s)
      const eth = toEthiopian(g)
      expect(fromEthiopian(eth)).toBe(g)
    }
  })

  it('places Ethiopian New Year (Meskerem 1, 2019) in September 2026, matching the 2019 E.C. school year this design targets', () => {
    const newYear2019 = ethiopianDate(2019, 1, 1)
    // Ethiopian New Year always falls on Sept 11 (or Sept 12 in the
    // Gregorian year before an Ethiopian leap year) — either is correct;
    // what matters is that it lands in September 2026, not some other year.
    expect(newYear2019.startsWith('2026-09-')).toBe(true)
  })

  it('formats an Ethiopian date for display in English, month-name form', () => {
    const meskerem5 = ethiopianDate(2019, 1, 5)
    expect(formatEthiopian(meskerem5)).toBe('Meskerem 5, 2019')
  })

  it('computes the default academic-year boundary (Meskerem 5 -> Sene 30) for 2019 E.C.', () => {
    const start = ethiopianDate(2019, 1, 5) // Meskerem 5
    const end = ethiopianDate(2019, 10, 30) // Sene 30
    // Sanity: the default boundary should span roughly eleven months and
    // land start-in-September, end-in-July of the following Gregorian year.
    expect(start.startsWith('2026-09-')).toBe(true)
    expect(end.startsWith('2027-07-')).toBe(true)
    expect(start < end).toBe(true)
  })
})
