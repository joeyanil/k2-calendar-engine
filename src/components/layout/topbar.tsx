import { Search, Bell } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Ported from k2-ui-foundation-test. Structurally unchanged. Search and
 * the notification bell are inert — the source package never wired them
 * to anything (no search index, no notification system exists anywhere
 * in K2 yet), and building either is out of scope for this merge. They're
 * kept because they're real shell chrome from the locked design system,
 * not because they do something: nothing happens on click.
 */
export function Topbar({
  userLabel,
  userSubLabel,
  chrome = 'surface',
}: {
  userLabel: string
  userSubLabel?: string
  chrome?: 'dark' | 'surface'
}) {
  return (
    <header
      className={cn(
        'flex h-16 items-center justify-between gap-4 border-b border-border px-4 lg:px-6',
        chrome === 'dark' ? 'bg-[hsl(var(--sidebar-bg))] text-[hsl(var(--sidebar-fg))] border-transparent' : 'bg-card',
      )}
    >
      <div
        className={cn(
          'flex h-10 max-w-sm flex-1 items-center gap-2 rounded-md border px-3 text-sm',
          chrome === 'dark' ? 'border-white/15 opacity-70' : 'border-border text-muted-foreground',
        )}
      >
        <Search className="h-4 w-4" strokeWidth={1.5} />
        <span>Search…</span>
        <kbd className="ml-auto text-xs opacity-60">⌘K</kbd>
      </div>
      <div className="flex items-center gap-4">
        <button
          aria-label="Notifications"
          className={cn('relative flex h-9 w-9 items-center justify-center rounded-md', chrome === 'dark' ? 'hover:bg-white/10' : 'hover:bg-muted')}
        >
          <Bell className="h-5 w-5" strokeWidth={1.5} />
        </button>
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {userLabel.slice(0, 2).toUpperCase()}
          </span>
          <span className="hidden flex-col sm:flex">
            <span>{userLabel}</span>
            {userSubLabel && <span className="text-xs font-normal text-muted-foreground">{userSubLabel}</span>}
          </span>
        </div>
      </div>
    </header>
  )
}
