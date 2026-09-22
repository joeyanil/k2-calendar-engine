import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

/**
 * NOT ported from either source package — neither one has this exact
 * shape. v2's every calendar page is built around a "titled section with
 * an optional action in the header" block (its old hand-rolled Panel);
 * the UI foundation package's Card/CardHeader/CardTitle/CardContent don't
 * have a title+action row baked in. Rather than keep v2's retired
 * component system alive just for this one shape, or force every page
 * into raw Card/CardHeader/CardContent (losing the title-left/action-right
 * row current pages depend on — e.g. "Timeline" with a "Rebuild & publish"
 * button in the header), this composes the two Card primitives K2's design
 * system already has into that same row. No new visual language: it's
 * exactly Card's border/radius/shadow tokens, just with a header layout.
 */
export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      {title && (
        <CardHeader className="flex-row items-center justify-between gap-4 border-b border-border">
          <CardTitle>{title}</CardTitle>
          {action}
        </CardHeader>
      )}
      <CardContent className={cn(title ? 'pt-4' : 'p-4')}>{children}</CardContent>
    </Card>
  )
}
