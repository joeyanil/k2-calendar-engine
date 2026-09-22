/**
 * dependencyGraph.ts — Deep Domain File 2 §E, mission section 33-34.
 *
 * Implements the generic DEPENDENT relationship mechanism: "X follows Y by
 * N days," explicitly declared, never inferred from proximity. This module
 * is deliberately generic — it has no idea what a "semester break" or a
 * "Grade 12 result deadline" is, it only knows about `CalendarFactRef`
 * pairs and day offsets. Which specific dependencies actually exist in K2
 * is a data/business-configuration question the domain files leave for the
 * admin to declare, not something this file hardcodes.
 */
import { AppError } from '../errors/AppError'
import { addDays } from './date-utils'
import type { ISODate } from './date-utils'
import type { CalendarFactRef, DependencyRule } from './types'
import { factRefKey } from './types'

/** Adjacency list keyed by the anchor's fact-ref key, pointing at every
 *  active rule anchored there. */
function buildAnchorIndex(rules: DependencyRule[]): Map<string, DependencyRule[]> {
  const index = new Map<string, DependencyRule[]>()
  for (const rule of rules) {
    if (!rule.active) continue
    const key = factRefKey(rule.anchor)
    const list = index.get(key)
    if (list) list.push(rule)
    else index.set(key, [rule])
  }
  return index
}

/**
 * Would adding `candidate` (anchor -> dependent) create a cycle with the
 * already-existing active rules? True iff `candidate.anchor` is already
 * reachable by following existing anchor -> dependent edges starting from
 * `candidate.dependent` — i.e. the new edge would close a loop
 * A -> B -> ... -> A (mission section 34: "Reject: A -> B -> C -> A").
 */
export function wouldCreateCycle(
  existingRules: DependencyRule[],
  candidate: Pick<DependencyRule, 'anchor' | 'dependent'>,
): boolean {
  const anchorKey = factRefKey(candidate.anchor)
  const dependentKey = factRefKey(candidate.dependent)
  if (anchorKey === dependentKey) return true // a fact cannot depend on itself

  const index = buildAnchorIndex(existingRules)
  const visited = new Set<string>()
  const stack = [dependentKey]

  while (stack.length > 0) {
    const currentKey = stack.pop() as string
    if (currentKey === anchorKey) return true
    if (visited.has(currentKey)) continue
    visited.add(currentKey)
    const outgoing = index.get(currentKey) ?? []
    for (const rule of outgoing) stack.push(factRefKey(rule.dependent))
  }
  return false
}

/** Rejects a cyclical dependency outright, before it ever reaches
 *  persistence (mission section 34). */
export function assertNoCycle(
  existingRules: DependencyRule[],
  candidate: Pick<DependencyRule, 'anchor' | 'dependent'>,
): void {
  if (wouldCreateCycle(existingRules, candidate)) {
    throw new AppError(
      'CALENDAR_CIRCULAR_DEPENDENCY',
      422,
      `Declaring "${factRefKey(candidate.dependent)} follows ${factRefKey(candidate.anchor)}" would create a circular dependency.`,
    )
  }
}

export interface DependencyImpact {
  ref: CalendarFactRef
  oldDate: ISODate | undefined
  newDate: ISODate
}

/**
 * Before a dependency's anchor date changes, shows exactly what would move
 * and by how much — including transitively, through chains of dependencies
 * (mission section 34: "Dependencies should support impact previews...
 * the admin must be able to see what would move"). This function only
 * *computes* the preview; nothing is applied until the caller explicitly
 * accepts it.
 */
export function previewDependencyImpact(
  changedRef: CalendarFactRef,
  newAnchorDate: ISODate,
  rules: DependencyRule[],
  resolvedFacts: Map<string, ISODate>,
): DependencyImpact[] {
  const index = buildAnchorIndex(rules)
  const impacts: DependencyImpact[] = []
  const visited = new Set<string>([factRefKey(changedRef)])
  const queue: Array<{ ref: CalendarFactRef; date: ISODate }> = [
    { ref: changedRef, date: newAnchorDate },
  ]

  while (queue.length > 0) {
    const current = queue.shift() as { ref: CalendarFactRef; date: ISODate }
    const outgoing = index.get(factRefKey(current.ref)) ?? []
    for (const rule of outgoing) {
      const dependentKey = factRefKey(rule.dependent)
      // Defense in depth: assertNoCycle should make this unreachable, but a
      // graph traversal must never infinite-loop even if that guard were
      // ever bypassed by a direct database write.
      if (visited.has(dependentKey)) continue
      visited.add(dependentKey)

      const newDependentDate = addDays(current.date, rule.offsetDays)
      impacts.push({
        ref: rule.dependent,
        oldDate: resolvedFacts.get(dependentKey),
        newDate: newDependentDate,
      })
      queue.push({ ref: rule.dependent, date: newDependentDate })
    }
  }
  return impacts
}

/**
 * Defense-in-depth aggregate check: scans the *entire* currently-persisted
 * rule set for any cycle at all, not just whether one candidate edge would
 * create one. `assertNoCycle` is the real gate (nothing cyclical should
 * ever reach persistence in the first place) — this is the safety net
 * `validation.ts` runs so a cycle introduced by any other path (a direct
 * database write, a bug, a future migration) still surfaces as a hard
 * ERROR rather than silently producing wrong dates. Returns the first cycle
 * found, as an ordered list of fact-ref keys, or null if the graph is
 * acyclic.
 */
export function detectAnyCycle(rules: DependencyRule[]): string[] | null {
  const index = buildAnchorIndex(rules)
  const allKeys = new Set<string>()
  for (const rule of rules) {
    if (!rule.active) continue
    allKeys.add(factRefKey(rule.anchor))
    allKeys.add(factRefKey(rule.dependent))
  }

  const WHITE = 0,
    GRAY = 1,
    BLACK = 2
  const color = new Map<string, number>()
  const path: string[] = []

  function visit(key: string): string[] | null {
    color.set(key, GRAY)
    path.push(key)
    for (const rule of index.get(key) ?? []) {
      const nextKey = factRefKey(rule.dependent)
      const state = color.get(nextKey) ?? WHITE
      if (state === GRAY) {
        const cycleStart = path.indexOf(nextKey)
        return [...path.slice(cycleStart), nextKey]
      }
      if (state === WHITE) {
        const found = visit(nextKey)
        if (found) return found
      }
    }
    path.pop()
    color.set(key, BLACK)
    return null
  }

  for (const key of allKeys) {
    if ((color.get(key) ?? WHITE) === WHITE) {
      const found = visit(key)
      if (found) return found
    }
  }
  return null
}

/** Resolves every DEPENDENT fact's concrete date from its rule and its
 *  anchor's current resolved date. Facts with no active dependency rule are
 *  left untouched in the returned map — they are INDEPENDENT (or DERIVED,
 *  handled separately by semesterBreak.ts) and already carry their own
 *  real value. Call repeatedly / in topological order is unnecessary here
 *  because `previewDependencyImpact`'s BFS order already resolves anchors
 *  before their dependents; this helper is the "apply" counterpart used
 *  once a preview has been accepted. */
export function applyDependencyImpacts(
  resolvedFacts: Map<string, ISODate>,
  impacts: DependencyImpact[],
): Map<string, ISODate> {
  const next = new Map(resolvedFacts)
  for (const impact of impacts) {
    next.set(factRefKey(impact.ref), impact.newDate)
  }
  return next
}
