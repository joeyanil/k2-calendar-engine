import { describe, expect, it } from 'vitest'
import { isoDate } from '@/lib/calendar/date-utils'
import { markSent, remindersDueOn, rescheduleForDateChange, scheduleReminders } from '@/lib/calendar/reminders'
import type { CalendarFactRef } from '@/lib/calendar/types'

const EXAM: CalendarFactRef = { kind: 'EXAM_START', examTypeKey: 'S1_FINAL' }

describe('reminders: scheduling thresholds', () => {
  it('schedules all three thresholds as PENDING when the event is far in the future', () => {
    const schedule = scheduleReminders(EXAM, isoDate('2027-01-04'), isoDate('2026-09-11'))
    expect(schedule).toHaveLength(3)
    expect(schedule.every((s) => s.status === 'PENDING')).toBe(true)
    expect(schedule.map((s) => s.triggerDate).sort()).toEqual(
      ['2026-12-05', '2026-12-20', '2026-12-30'].sort(), // 30/15/5 days before 2027-01-04
    )
  })

  it('marks a threshold SKIPPED if its trigger date has already passed relative to now', () => {
    // "now" is only 10 days before the event — the 30- and 15-day
    // thresholds have already passed; only the 5-day one is still ahead.
    const schedule = scheduleReminders(EXAM, isoDate('2027-01-04'), isoDate('2026-12-25'))
    const byThreshold = Object.fromEntries(schedule.map((s) => [s.thresholdDays, s.status]))
    expect(byThreshold[30]).toBe('SKIPPED')
    expect(byThreshold[15]).toBe('SKIPPED')
    expect(byThreshold[5]).toBe('PENDING')
  })

  it('never marks anything DUE at schedule time — only PENDING or SKIPPED', () => {
    const schedule = scheduleReminders(EXAM, isoDate('2027-01-04'), isoDate('2026-12-30')) // exactly the 5-day mark
    expect(schedule.every((s) => s.status === 'PENDING' || s.status === 'SKIPPED')).toBe(true)
  })
})

describe('reminders: what fires today', () => {
  it('fires a PENDING reminder exactly on its trigger date', () => {
    const schedule = scheduleReminders(EXAM, isoDate('2027-01-04'), isoDate('2026-09-11'))
    const due = remindersDueOn(schedule, isoDate('2026-12-30')) // the 5-day mark
    expect(due).toHaveLength(1)
    expect(due[0]?.thresholdDays).toBe(5)
  })

  it('fires nothing on an ordinary day with no matching threshold', () => {
    const schedule = scheduleReminders(EXAM, isoDate('2027-01-04'), isoDate('2026-09-11'))
    expect(remindersDueOn(schedule, isoDate('2026-10-01'))).toHaveLength(0)
  })

  it('never re-fires a SENT reminder even if checked again on its trigger date', () => {
    const schedule = scheduleReminders(EXAM, isoDate('2027-01-04'), isoDate('2026-09-11'))
    const fiveDayReminder = schedule.find((s) => s.thresholdDays === 5)!
    const sent = markSent(fiveDayReminder, '2026-12-30T08:00:00Z')
    const updated = schedule.map((s) => (s.thresholdDays === 5 ? sent : s))
    expect(remindersDueOn(updated, isoDate('2026-12-30'))).toHaveLength(0)
  })
})

describe('reminders: no retroactive firing when a plan is entered late (mission section 39)', () => {
  it('an exam confirmed after its 30-day and 15-day thresholds have passed never fires those late', () => {
    // The exam date is only entered into the system on Dec 28 — five days
    // before the exam. The 30- and 15-day thresholds are already history.
    const schedule = scheduleReminders(EXAM, isoDate('2027-01-04'), isoDate('2026-12-28'))
    const byThreshold = Object.fromEntries(schedule.map((s) => [s.thresholdDays, s]))
    expect(byThreshold[30]?.status).toBe('SKIPPED')
    expect(byThreshold[15]?.status).toBe('SKIPPED')
    // Running "what fires today" on any later date never resurrects them.
    expect(remindersDueOn(schedule, isoDate('2026-12-29'))).toHaveLength(0)
    expect(remindersDueOn(schedule, isoDate('2027-01-04'))).toHaveLength(0)
  })
})

describe('reminders: rescheduling when the underlying date changes', () => {
  it('recalculates PENDING reminders fresh against the new date', () => {
    const original = scheduleReminders(EXAM, isoDate('2027-01-04'), isoDate('2026-09-11'))
    const rescheduled = rescheduleForDateChange(original, isoDate('2027-02-01'), isoDate('2026-09-11'))
    expect(rescheduled.every((s) => s.dueDate === '2027-02-01')).toBe(true)
    expect(rescheduled.find((s) => s.thresholdDays === 5)?.triggerDate).toBe('2027-01-27')
  })

  it('leaves an already-SENT reminder untouched when the date changes', () => {
    const original = scheduleReminders(EXAM, isoDate('2027-01-04'), isoDate('2026-09-11'))
    const sentThirty = markSent(original.find((s) => s.thresholdDays === 30)!, '2026-12-05T00:00:00Z')
    const mixed = original.map((s) => (s.thresholdDays === 30 ? sentThirty : s))

    const rescheduled = rescheduleForDateChange(mixed, isoDate('2027-02-01'), isoDate('2026-12-10'))
    const thirty = rescheduled.find((s) => s.thresholdDays === 30)
    expect(thirty?.status).toBe('SENT')
    expect(thirty?.dueDate).toBe('2027-01-04') // historical — untouched, NOT rewritten to the new date
    const fifteen = rescheduled.find((s) => s.thresholdDays === 15)
    expect(fifteen?.dueDate).toBe('2027-02-01') // recalculated against the new date
  })
})
