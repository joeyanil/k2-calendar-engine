import { describe, expect, it } from 'vitest'
import { isoDate } from '@/lib/calendar/date-utils'
import { buildFullYearTimeline } from '@/lib/calendar/timelineBuilder'
import { attemptPublish, hashConfiguration, assertPublishable } from '@/lib/calendar/rebuild'
import type { CalendarConfiguration, TimelineBuildMeta } from '@/lib/calendar/types'
import { AppError } from '@/lib/errors/AppError'

function buildEntries() {
  const config: CalendarConfiguration = {
    academicYear: { id: 'y', startDate: isoDate('2026-09-11'), endDate: isoDate('2026-09-20') },
    semesters: [],
    holidayOccurrences: [],
    examInstances: [],
    studentReturn: null,
  }
  return buildFullYearTimeline(config)
}

const START = isoDate('2026-09-11')
const END = isoDate('2026-09-20')

function meta(overrides: Partial<TimelineBuildMeta>): TimelineBuildMeta {
  return {
    id: 'b',
    academicYearId: 'y',
    status: 'CURRENT',
    configRevision: 1,
    configHash: 'abc',
    createdAt: '2026-09-01T00:00:00Z',
    publishedAt: '2026-09-01T00:05:00Z',
    failureReason: null,
    ...overrides,
  }
}

describe('rebuild: happy path', () => {
  it('publishes when there is no current build yet and the candidate matches the live revision', () => {
    const result = attemptPublish({
      candidateEntries: buildEntries(),
      candidateExpectedStart: START,
      candidateExpectedEnd: END,
      candidateExpectedDays: 10,
      candidateSourceConfigRevision: 1,
      liveConfigRevision: 1,
      currentBuild: null,
    })
    expect(result.outcome).toBe('PUBLISHED')
  })

  it('publishes when the candidate matches the live revision, even with an older CURRENT build present', () => {
    const result = attemptPublish({
      candidateEntries: buildEntries(),
      candidateExpectedStart: START,
      candidateExpectedEnd: END,
      candidateExpectedDays: 10,
      candidateSourceConfigRevision: 2,
      liveConfigRevision: 2,
      currentBuild: meta({ id: 'b1', configRevision: 1 }),
    })
    expect(result.outcome).toBe('PUBLISHED')
  })

  it('allows a second candidate for the SAME (still-current) revision to publish, superseding an equivalent one — by design: the authority is "does this match the live revision", not "is this the highest version seen"', () => {
    const result = attemptPublish({
      candidateEntries: buildEntries(),
      candidateExpectedStart: START,
      candidateExpectedEnd: END,
      candidateExpectedDays: 10,
      candidateSourceConfigRevision: 1,
      liveConfigRevision: 1,
      currentBuild: meta({ id: 'b1', configRevision: 1 }),
    })
    expect(result.outcome).toBe('PUBLISHED')
  })
})

describe('rebuild: staleness guard (v2 repair fix #1 — a real configuration revision, not a build counter)', () => {
  it('rejects a candidate whose source revision no longer matches the live revision — the exact fix #1 scenario: built once, facts changed, no second build ever existed', () => {
    // A build-counter model ("current build's version, or -1 if none exists")
    // could not catch this: with no current build at all, there was nothing
    // to compare against, so an obsolete candidate looked publishable. The
    // real fix is comparing directly against the year's LIVE revision,
    // which has moved regardless of whether anyone ever rebuilt.
    const result = attemptPublish({
      candidateEntries: buildEntries(),
      candidateExpectedStart: START,
      candidateExpectedEnd: END,
      candidateExpectedDays: 10,
      candidateSourceConfigRevision: 1, // captured before the edit
      liveConfigRevision: 2, // a fact was edited after this candidate was built
      currentBuild: null, // and crucially: no second build was ever made
    })
    expect(result.outcome).toBe('REJECTED_STALE')
  })

  it('rejects a candidate built from an older revision than what is already current', () => {
    // Mission section 30's scenario: config A (revision 1) starts
    // rebuilding, config B (revision 2) is saved and starts rebuilding, B
    // finishes and publishes first, then A finishes late.
    const result = attemptPublish({
      candidateEntries: buildEntries(),
      candidateExpectedStart: START,
      candidateExpectedEnd: END,
      candidateExpectedDays: 10,
      candidateSourceConfigRevision: 1, // A, finishing late
      liveConfigRevision: 2, // B already published, and is also the live revision
      currentBuild: meta({ id: 'b2', configRevision: 2 }),
    })
    expect(result.outcome).toBe('REJECTED_STALE')
  })

  it('assertPublishable throws CALENDAR_STALE_BUILD for a stale candidate', () => {
    expect(() =>
      assertPublishable({
        candidateEntries: buildEntries(),
        candidateExpectedStart: START,
        candidateExpectedEnd: END,
        candidateExpectedDays: 10,
        candidateSourceConfigRevision: 3,
        liveConfigRevision: 5,
        currentBuild: meta({ id: 'b2', configRevision: 5 }),
      }),
    ).toThrow(AppError)
  })
})

describe('rebuild: a failed rebuild leaves the previous valid timeline untouched', () => {
  it('rejects an invalid candidate without ever mentioning replacing the current build', () => {
    const brokenEntries = buildEntries().slice(0, 5) // artificially truncated -> fails integrity
    const result = attemptPublish({
      candidateEntries: brokenEntries,
      candidateExpectedStart: START,
      candidateExpectedEnd: END,
      candidateExpectedDays: 10,
      candidateSourceConfigRevision: 99,
      liveConfigRevision: 99,
      currentBuild: null,
    })
    expect(result.outcome).toBe('REJECTED_INVALID')
    if (result.outcome === 'REJECTED_INVALID') {
      expect(result.issues.length).toBeGreaterThan(0)
    }
  })
})

describe('rebuild: configuration hashing', () => {
  it('produces the same hash for equivalent configurations regardless of key order', () => {
    const a = hashConfiguration({ start: '2026-09-11', end: '2027-07-08', holidays: ['NEW_YEAR'] })
    const b = hashConfiguration({ end: '2027-07-08', holidays: ['NEW_YEAR'], start: '2026-09-11' })
    expect(a).toBe(b)
  })

  it('produces a different hash when the underlying data actually changes', () => {
    const a = hashConfiguration({ start: '2026-09-11' })
    const b = hashConfiguration({ start: '2026-09-12' })
    expect(a).not.toBe(b)
  })
})
