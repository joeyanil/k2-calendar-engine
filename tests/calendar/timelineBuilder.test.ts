import { describe, expect, it } from 'vitest'
import { isoDate } from '@/lib/calendar/date-utils'
import { createHolidayOccurrence } from '@/lib/calendar/holidays'
import { buildFullYearTimeline, verifyTimelineIntegrity } from '@/lib/calendar/timelineBuilder'
import type { CalendarConfiguration, ExamInstance, Semester } from '@/lib/calendar/types'
import { AppError } from '@/lib/errors/AppError'

function baseConfig(overrides: Partial<CalendarConfiguration> = {}): CalendarConfiguration {
  const semesters: Semester[] = [
    { id: 's1', academicYearId: 'y2019', order: 1, startDate: isoDate('2026-09-14'), endDate: isoDate('2027-01-15'), status: 'ACTIVE' },
    { id: 's2', academicYearId: 'y2019', order: 2, startDate: isoDate('2027-02-01'), endDate: isoDate('2027-07-01'), status: 'UPCOMING' },
  ]
  return {
    academicYear: { id: 'y2019', startDate: isoDate('2026-09-11'), endDate: isoDate('2027-07-08') },
    semesters,
    holidayOccurrences: [],
    examInstances: [],
    studentReturn: null,
    ...overrides,
  }
}

describe('timelineBuilder: date generation invariants (mission section 16)', () => {
  it('builds a single-day timeline correctly', () => {
    const config = baseConfig({
      academicYear: { id: 'y', startDate: isoDate('2026-09-11'), endDate: isoDate('2026-09-11') },
    })
    const entries = buildFullYearTimeline(config)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.date).toBe('2026-09-11')
  })

  it('builds a full academic-year timeline with the exact expected count', () => {
    const entries = buildFullYearTimeline(baseConfig())
    // 2026-09-11 .. 2027-07-08 inclusive
    expect(entries).toHaveLength(301)
    expect(entries[0]?.date).toBe('2026-09-11')
    expect(entries[entries.length - 1]?.date).toBe('2027-07-08')
  })

  it('never skips a day and never duplicates one, across a Gregorian leap-year February', () => {
    const config = baseConfig({
      academicYear: { id: 'y', startDate: isoDate('2027-12-20'), endDate: isoDate('2028-03-05') }, // 2028 is a leap year
    })
    const entries = buildFullYearTimeline(config)
    const dates = entries.map((e) => e.date)
    expect(new Set(dates).size).toBe(dates.length) // no duplicates
    expect(dates).toContain('2028-02-29') // leap day present
    expect(dates).toContain('2028-03-01') // and continues correctly past it
  })

  it('rejects (throws) rather than builds when start is after end', () => {
    const config = baseConfig({
      academicYear: { id: 'y', startDate: isoDate('2027-01-01'), endDate: isoDate('2026-01-01') },
    })
    expect(() => buildFullYearTimeline(config)).toThrow(AppError)
  })

  it('every adjacent pair of entries differs by exactly one calendar day', () => {
    const entries = buildFullYearTimeline(baseConfig())
    for (let i = 1; i < entries.length; i++) {
      const prevDate = entries[i - 1]?.date
      const curDate = entries[i]?.date
      expect(prevDate).toBeDefined()
      expect(curDate).toBeDefined()
    }
    const report = verifyTimelineIntegrity(entries, '2026-09-11' as never, '2027-07-08' as never, entries.length)
    expect(report.valid).toBe(true)
    expect(report.issues).toHaveLength(0)
  })
})

describe('timelineBuilder: weekly pattern', () => {
  it('marks every Saturday and Sunday as weekend, and nothing else', () => {
    const entries = buildFullYearTimeline(baseConfig())
    for (const entry of entries) {
      const expected = entry.weekday === 'SATURDAY' || entry.weekday === 'SUNDAY'
      expect(entry.isWeekend).toBe(expected)
    }
  })

  it('weekends are never teaching days and never attendance-available', () => {
    const entries = buildFullYearTimeline(baseConfig())
    for (const entry of entries.filter((e) => e.isWeekend)) {
      expect(entry.teachingDay).toBe(false)
      expect(entry.attendanceAvailable).toBe(false)
      expect(entry.reasons).toContain('WEEKEND')
    }
  })
})

describe('timelineBuilder: holidays', () => {
  it('a closing holiday on a weekday removes teaching/attendance for that date only', () => {
    const holiday = { ...createHolidayOccurrence({ academicYearId: 'y2019', holidayTypeKey: 'TIMKAT', ethiopianYear: 2019 }), id: 'h1' }
    const entries = buildFullYearTimeline(baseConfig({ holidayOccurrences: [holiday] }))
    const day = entries.find((e) => e.date === holiday.date)
    expect(day).toBeDefined()
    expect(day?.schoolOpen).toBe(false)
    expect(day?.teachingDay).toBe(false)
    expect(day?.holidays[0]?.typeKey).toBe('TIMKAT')
  })

  it('a holiday with closure turned off does NOT remove the teaching day', () => {
    // Adwa Victory Day 2019 (Yekatit 23 -> 2027-03-02) falls well inside
    // Semester 2 in the fixture, clear of the derived break — isolating
    // exactly the behavior under test (closure toggle), rather than also
    // being inside the break for an unrelated reason.
    const holiday = {
      ...createHolidayOccurrence({ academicYearId: 'y2019', holidayTypeKey: 'ADWA', ethiopianYear: 2019 }),
      id: 'h1',
      closesSchool: false,
    }
    const entries = buildFullYearTimeline(baseConfig({ holidayOccurrences: [holiday] }))
    const day = entries.find((e) => e.date === holiday.date)
    expect(day?.holidays[0]?.closesSchool).toBe(false)
    expect(day?.isWeekend).toBe(false)
    expect(day?.isSemesterBreak).toBe(false)
    expect(day?.teachingDay).toBe(true)
    expect(day?.schoolOpen).toBe(true)
  })
})

describe('timelineBuilder: exams', () => {
  it('a standard (closing) exam window removes teaching/attendance and numbers each day', () => {
    const instance: ExamInstance = {
      id: 'e1',
      academicYearId: 'y2019',
      examTypeKey: 'S1_FINAL',
      startDate: isoDate('2026-12-07'), // a Monday
      endDate: isoDate('2026-12-11'), // Friday
    }
    const entries = buildFullYearTimeline(baseConfig({ examInstances: [instance] }))
    const days = entries.filter((e) => e.exams.some((x) => x.typeKey === 'S1_FINAL'))
    expect(days).toHaveLength(5)
    expect(days.map((d) => d.exams.find((x) => x.typeKey === 'S1_FINAL')?.dayNumber)).toEqual([1, 2, 3, 4, 5])
    for (const d of days) {
      expect(d.teachingDay).toBe(false)
      expect(d.schoolOpen).toBe(false)
      expect(d.attendanceAvailable).toBe(false)
    }
  })

  it('the Grade 12 National Exam never closes the whole school', () => {
    const instance: ExamInstance = {
      id: 'e2',
      academicYearId: 'y2019',
      examTypeKey: 'GRADE12_NATIONAL',
      startDate: isoDate('2027-05-10'), // Monday
      endDate: isoDate('2027-05-12'),
    }
    const entries = buildFullYearTimeline(baseConfig({ examInstances: [instance] }))
    const days = entries.filter((e) => e.exams.some((x) => x.typeKey === 'GRADE12_NATIONAL'))
    expect(days).toHaveLength(3)
    for (const d of days) {
      expect(d.schoolOpen).toBe(true)
      expect(d.teachingDay).toBe(true) // whole-school teaching continues
      expect(d.attendanceAvailable).toBe(true) // whole-school attendance unaffected
      expect(d.grade12AttendanceAvailable).toBe(false) // narrower exception
    }
  })
})

describe('timelineBuilder: Student Return', () => {
  it('is open, non-teaching, and not treated as a holiday', () => {
    const date = isoDate('2026-09-14') // Meskerem 4, 2019 — a weekday in this fixture
    const entries = buildFullYearTimeline(
      baseConfig({ studentReturn: { id: 'sr1', academicYearId: 'y2019', date } }),
    )
    const day = entries.find((e) => e.date === date)
    expect(day?.isStudentReturn).toBe(true)
    expect(day?.holidays).toEqual([])
    expect(day?.schoolOpen).toBe(true)
    expect(day?.teachingDay).toBe(false)
    expect(day?.attendanceAvailable).toBe(false)
  })
})

describe('timelineBuilder: derived semester break', () => {
  it('flags weekdays inside the gap between semesters as break days, non-teaching', () => {
    const entries = buildFullYearTimeline(baseConfig())
    const breakDay = entries.find((e) => e.date === '2027-01-20') // between S1 end (01-15) and S2 start (02-01)
    expect(breakDay?.isSemesterBreak).toBe(true)
    expect(breakDay?.teachingDay).toBe(false)
    expect(breakDay?.schoolOpen).toBe(false)
  })

  it('dates inside either semester are not flagged as break', () => {
    const entries = buildFullYearTimeline(baseConfig())
    const midSemester = entries.find((e) => e.date === '2026-10-05')
    expect(midSemester?.isSemesterBreak).toBe(false)
    expect(midSemester?.semesterOrder).toBe(1)
  })
})

describe('timelineBuilder: semester membership', () => {
  it('assigns the correct semester order to dates inside each semester, and null in the gap', () => {
    const entries = buildFullYearTimeline(baseConfig())
    expect(entries.find((e) => e.date === '2026-11-01')?.semesterOrder).toBe(1)
    expect(entries.find((e) => e.date === '2027-03-01')?.semesterOrder).toBe(2)
    expect(entries.find((e) => e.date === '2027-01-20')?.semesterOrder).toBeNull() // inside the break
    expect(entries.find((e) => e.date === '2026-09-11')?.semesterOrder).toBeNull() // before S1 starts
  })
})
