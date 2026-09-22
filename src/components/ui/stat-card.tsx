import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'

// doc 20 §6 Stat Card: label (caption) → big number (Display weight,
// brand-primary or a semantic color if the stat IS a status) → optional
// trend line. Admin/Main Admin stay numeral-only, no sparkline decoration.
export function StatCard({
  label,
  value,
  tone = 'primary',
  href,
  className,
}: {
  label: string
  value: string
  tone?: 'primary' | 'success' | 'warning' | 'error' | 'info'
  href?: string
  className?: string
}) {
  // FIX (v2 merge): same bug as Badge (see badge.tsx) was present here too,
  // just not the specific instance the UI foundation README happened to
  // flag — `text-success` / `text-warning` / `text-error` / `text-info`
  // is the raw, portal-invariant semantic color as literal text, which
  // fails AA in most portal/background combinations. Swapped to the
  // `*-text` tokens, same as Badge.
  const toneClass = {
    primary: 'text-foreground',
    success: 'text-success-text',
    warning: 'text-warning-text',
    error: 'text-error-text',
    info: 'text-info-text',
  }[tone]

  const content = (
    <Card className={cn('p-4', className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-3xl font-bold tabular-nums', toneClass)}>{value}</p>
    </Card>
  )

  // "Every stat card is a filtered shortcut, not decoration" — doc 23 Part A
  return href ? <a href={href}>{content}</a> : content
}
