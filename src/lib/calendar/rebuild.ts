/**
 * rebuild.ts — mission sections 29-32, revised under the v2 repair guide's
 * fixes #1/#3/#28.
 *
 * This module is the *pure, client-side mirror* of the publish decision —
 * useful for fast unit tests and for failing fast before ever calling the
 * database. It is deliberately NOT the authority: `fn_publish_calendar_timeline`
 * (supabase/migrations/0013 as amended by 0015) re-derives every one of
 * these checks itself, against live data, under a row lock, and is what
 * actually decides. A caller could skip this file entirely and the system
 * would still be safe; this file exists so the same rule is unit-testable
 * without spinning up Postgres, and so failures surface before a network
 * round-trip.
 *
 * The staleness rule changed from "is my version >= the current build's
 * version" (a build COUNTER comparison) to "does my source_config_revision
 * still equal the year's live revision" (a configuration IDENTITY
 * comparison). The old form could not detect the case where a candidate was
 * built once, the underlying facts were edited, and no second build was
 * ever made — nothing else would have a "newer version" to compare against,
 * so the stale candidate looked fine. The new form catches this because the
 * revision moves on every real fact edit, independent of whether anyone
 * rebuilt.
 */
import { AppError } from '../errors/AppError'
import type { DailyTimelineEntry, TimelineBuildMeta } from './types'
import { verifyTimelineIntegrity } from './timelineBuilder'
import type { ISODate } from './date-utils'

export interface PublishAttempt {
  candidateEntries: DailyTimelineEntry[]
  candidateExpectedStart: ISODate
  candidateExpectedEnd: ISODate
  candidateExpectedDays: number
  /** The academic year's `calendar_config_revision` at the moment this
   *  candidate's configuration snapshot was read — NOT a build counter. */
  candidateSourceConfigRevision: number
  /** The year's LIVE revision, read fresh at the moment publication is
   *  attempted — not whatever the previous CURRENT build claims. This is
   *  what makes the check correct even when no other build exists yet. */
  liveConfigRevision: number
  /** Purely informational context for the rejection/success message —
   *  not itself part of the decision. */
  currentBuild: TimelineBuildMeta | null
}

export type PublishResult =
  | { outcome: 'PUBLISHED'; reason: string }
  | { outcome: 'REJECTED_STALE'; reason: string }
  | { outcome: 'REJECTED_INVALID'; reason: string; issues: string[] }

/**
 * Decides whether a candidate build may become CURRENT. Never mutates
 * anything — callers apply the result inside their own transaction, and the
 * database independently re-checks all of this regardless of what this
 * function returns.
 */
export function attemptPublish(attempt: PublishAttempt): PublishResult {
  const integrity = verifyTimelineIntegrity(
    attempt.candidateEntries,
    attempt.candidateExpectedStart,
    attempt.candidateExpectedEnd,
    attempt.candidateExpectedDays,
  )
  if (!integrity.valid) {
    return {
      outcome: 'REJECTED_INVALID',
      reason: 'Candidate timeline failed integrity verification.',
      issues: integrity.issues,
    }
  }

  if (attempt.candidateSourceConfigRevision !== attempt.liveConfigRevision) {
    return {
      outcome: 'REJECTED_STALE',
      reason: `The academic year is now at configuration revision ${attempt.liveConfigRevision}; this candidate was built from revision ${attempt.candidateSourceConfigRevision} and no longer reflects the current facts.`,
    }
  }

  return {
    outcome: 'PUBLISHED',
    reason: `Candidate built from revision ${attempt.candidateSourceConfigRevision} published — it matches the year's current live revision.`,
  }
}

/** Asserts a successful publish, or throws the appropriate AppError — the
 *  convenience wrapper services call directly. */
export function assertPublishable(attempt: PublishAttempt): void {
  const result = attemptPublish(attempt)
  if (result.outcome === 'REJECTED_INVALID') {
    throw new AppError('CALENDAR_TIMELINE_INTEGRITY_FAILURE', 500, result.reason, result.issues)
  }
  if (result.outcome === 'REJECTED_STALE') {
    throw new AppError('CALENDAR_STALE_BUILD', 409, result.reason)
  }
}

/** A simple, stable hash of a configuration snapshot, used as the
 *  human-inspectable `configHash` on a build record — a diagnostic aid
 *  ("did the content actually differ between two adjacent revisions"), not
 *  itself the staleness authority (that's calendar_config_revision).
 *  Not cryptographic; this only needs to change whenever the input changes,
 *  and stay stable when it doesn't. Callers pass in a stable
 *  JSON-serializable snapshot (e.g. all resolved dates + closure flags),
 *  not raw DB rows with volatile fields like `updated_at`. */
export function hashConfiguration(snapshot: unknown): string {
  const json = stableStringify(snapshot)
  let hash = 0
  for (let i = 0; i < json.length; i++) {
    hash = (Math.imul(31, hash) + json.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`
}
