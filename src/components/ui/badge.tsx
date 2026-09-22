import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { CheckCircle2, Lock, Clock, BadgeCheck } from 'lucide-react'

export function Badge({
  tone = 'info',
  className,
  children,
}: {
  tone?: 'success' | 'warning' | 'error' | 'info' | 'neutral'
  className?: string
  children: ReactNode
}) {
  // Full static class strings on purpose — Tailwind's JIT scanner can't see
  // through `bg-${tone}/15` template interpolation, so a dynamically-built
  // class name silently never ships in the production CSS.
  //
  // FIX (v2 merge): the UI foundation package used `text-success` /
  // `text-warning` / `text-error` / `text-info` here — the raw, portal-
  // invariant semantic color as literal text. Its own README flagged this
  // as failing WCAG AA in several portal/background combinations (as low
  // as 2.77:1) and left it unresolved. Swapped to the new `*-text` tokens
  // (globals.css), a portal-scoped shade of the same hue verified >=5:1
  // against every real surface it's used on. The tinted /15 background is
  // unchanged — only the text color changes.
  const toneClass = {
    success: 'bg-success/15 text-success-text',
    warning: 'bg-warning/15 text-warning-text',
    error: 'bg-error/15 text-error-text',
    info: 'bg-info/15 text-info-text',
    neutral: 'bg-muted text-muted-foreground',
  }[tone]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', toneClass, className)}>
      {children}
    </span>
  )
}

// doc 20 §12 — a small, fixed vocabulary reused everywhere, never a
// one-off label invented per screen. Ported verbatim from
// k2-ui-foundation-test (only the Badge it renders through changed).
export function AccessStateBadge({ state }: { state: 'allowed' | 'restricted' | 'pending' | 'locked' }) {
  const map = {
    allowed: { icon: CheckCircle2, tone: 'success' as const, label: 'Allowed' },
    restricted: { icon: Lock, tone: 'warning' as const, label: 'Restricted' },
    pending: { icon: Clock, tone: 'warning' as const, label: 'Pending Approval' },
    locked: { icon: Lock, tone: 'neutral' as const, label: 'Locked' },
  }[state]
  const Icon = map.icon
  return (
    <Badge tone={map.tone}>
      <Icon className="h-3 w-3" />
      {map.label}
    </Badge>
  )
}

// doc 20 §12 — "Live · Unofficial", info-toned, on every live mark/average
// until that subject actually LOCKs. Not currently used by any Calendar
// Engine page (nothing here has a "live, unofficial" figure) — kept
// available since it's real, doc-verified UI, not demo filler.
export function K2LiveBadge() {
  return (
    <Badge tone="info">
      <BadgeCheck className="h-3 w-3" />
      Live · Unofficial
    </Badge>
  )
}

// ---- Calendar Engine-specific badges (v2) ----
// Ported from v2's own components/ui/Badge.tsx, rebuilt on top of the new
// Badge above instead of v2's retired hand-rolled tone system.

const YEAR_STATUS_TONE: Record<string, Parameters<typeof Badge>[0]['tone']> = {
  PREPARING: 'neutral',
  READY: 'info',
  ACTIVE: 'success',
  CLOSED: 'neutral',
  UPCOMING: 'neutral',
}

/**
 * Maps an academic year's lifecycle status to a Badge tone. Doc 20 doesn't
 * define a year-lifecycle vocabulary (it's specific to this subsystem, not
 * shared K2 UI) — this mapping is this merge's own judgment call, not a
 * spec value: READY -> info (it's a settled-but-not-yet-live state, same
 * idea as doc 20's "Pending"/"Restricted" family), ACTIVE -> success,
 * everything else -> neutral.
 */
export function LifecycleBadge({ status }: { status: string }) {
  return <Badge tone={YEAR_STATUS_TONE[status] ?? 'neutral'}>{status}</Badge>
}

const SEVERITY_TONE: Record<string, Parameters<typeof Badge>[0]['tone']> = {
  MISSING: 'neutral',
  ERROR: 'error',
  WARNING: 'warning',
  INFORMATION: 'info',
}

/** Maps a calendar validation issue's severity (lib/calendar's Missing/Error/Warning/Information vocabulary) to a Badge tone. */
export function SeverityBadge({ severity }: { severity: string }) {
  return <Badge tone={SEVERITY_TONE[severity] ?? 'neutral'}>{severity}</Badge>
}
