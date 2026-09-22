/**
 * reminders.ts — mission section 38-39.
 *
 * "The decision of when to trigger belongs to Calendar. The actual message
 * delivery can reuse the existing notification mechanism" — this module is
 * exactly that decision, and nothing else. It has no idea how a
 * notification actually gets delivered; `notification.port.ts` covers that
 * seam. This file only ever answers "is threshold T due for fact F, given
 * today is D" and "what happened when the plan showed up late."
 *
 * The late-activation rule (section 39) is the one subtle part: a threshold
 * whose date has already passed by the time the underlying fact is entered
 * must be marked SKIPPED immediately, not fired the moment someone notices
 * it. It can never become DUE later — only PENDING thresholds (still in the
 * future relative to "now" at schedule time) can ever fire.
 */
import { addDays, compareISODate } from './date-utils'
import type { ISODate } from './date-utils'
import type { CalendarFactRef } from './types'

export const REMINDER_THRESHOLDS_DAYS = [30, 15, 5] as const
export type ReminderThresholdDays = (typeof REMINDER_THRESHOLDS_DAYS)[number]

export type ReminderStatus = 'PENDING' | 'SKIPPED' | 'SENT'

export interface ReminderSchedule {
  fact: CalendarFactRef
  thresholdDays: ReminderThresholdDays
  /** The date this reminder should fire on: `dueDate - thresholdDays`. */
  triggerDate: ISODate
  /** The date of the underlying event itself (exam start, etc.). */
  dueDate: ISODate
  status: ReminderStatus
  sentAt: string | null
}

/**
 * Builds the reminder schedule for one Calendar fact, evaluated as of
 * `referenceNow`. Every threshold whose trigger date has already passed is
 * marked SKIPPED immediately — it will never fire, not even late (mission
 * section 39: "no retroactive notification fire"). Everything else is
 * PENDING, to be fired by a daily job when `triggerDate` arrives.
 */
export function scheduleReminders(
  fact: CalendarFactRef,
  dueDate: ISODate,
  referenceNow: ISODate,
): ReminderSchedule[] {
  return REMINDER_THRESHOLDS_DAYS.map((thresholdDays) => {
    const triggerDate = addDays(dueDate, -thresholdDays)
    const alreadyPassed = compareISODate(triggerDate, referenceNow) < 0
    return {
      fact,
      thresholdDays,
      triggerDate,
      dueDate,
      status: alreadyPassed ? 'SKIPPED' : 'PENDING',
      sentAt: null,
    }
  })
}

/** What a daily reminder job should actually fire today: every PENDING
 *  schedule entry whose `triggerDate` is today. SENT and SKIPPED entries
 *  are never returned — historical, or permanently bypassed. */
export function remindersDueOn(schedules: ReminderSchedule[], today: ISODate): ReminderSchedule[] {
  return schedules.filter((s) => s.status === 'PENDING' && s.triggerDate === today)
}

/** Marks a fired reminder as sent. Sent reminders are historical from this
 *  point on — `rescheduleForDateChange` below will never touch them again. */
export function markSent(schedule: ReminderSchedule, sentAt: string): ReminderSchedule {
  return { ...schedule, status: 'SENT', sentAt }
}

/**
 * When the underlying fact's date moves, every not-yet-sent reminder
 * (PENDING or SKIPPED) is recalculated fresh against the new date; anything
 * already SENT is left untouched as historical record (mission section 37:
 * "Sent notifications remain historical. Only pending/not-yet-sent
 * reminders are recalculated.").
 */
export function rescheduleForDateChange(
  existing: ReminderSchedule[],
  newDueDate: ISODate,
  referenceNow: ISODate,
): ReminderSchedule[] {
  const sent = existing.filter((s) => s.status === 'SENT')
  const fact = existing[0]?.fact
  if (!fact) return sent // nothing to reschedule against — defensive
  const fresh = scheduleReminders(fact, newDueDate, referenceNow)
  // Don't reschedule a threshold that has already fired for this fact.
  const sentThresholds = new Set(sent.map((s) => s.thresholdDays))
  return [...sent, ...fresh.filter((f) => !sentThresholds.has(f.thresholdDays))]
}
