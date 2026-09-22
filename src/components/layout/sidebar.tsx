'use client'

import { CalendarDays, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

// Icons can't be passed from a Server Component (calendar/layout.tsx) as
// component references — React can't serialize a function/component across
// the server->client boundary. So NavItem.icon is a string key into this
// map, resolved here on the client, instead of a LucideIcon value itself.
const ICONS: Record<string, LucideIcon> = {
  CalendarDays,
}

export type NavItem = { label: string; icon: keyof typeof ICONS; href: string }
export type NavGroup = { label?: string; items: NavItem[] }

// doc 20 §9: Admin's sidebar/topbar use brand-surface-dark (K2 Navy) while
// its content area stays light (Cloud) — dark chrome, light content.
// Ported from k2-ui-foundation-test's Sidebar, with two changes: items now
// carry a real `href` (the demo used `href="#"` everywhere), and "active"
// is computed from the current URL via `usePathname()` instead of being
// passed in as a hardcoded per-item boolean — the demo only ever rendered
// one static page per portal, so it never needed to distinguish
// /calendar from /calendar/[yearId].
export function Sidebar({
  title,
  groups,
  chrome = 'surface',
}: {
  title: string
  groups: NavGroup[]
  chrome?: 'dark' | 'surface'
}) {
  const pathname = usePathname()

  return (
    <aside
      className={cn(
        'hidden w-64 shrink-0 flex-col gap-6 border-r border-border p-4 lg:flex',
        chrome === 'dark' ? 'bg-[hsl(var(--sidebar-bg))] text-[hsl(var(--sidebar-fg))] border-transparent' : 'bg-card',
      )}
    >
      <div className="px-2 text-lg font-bold tracking-tight">{title}</div>
      <nav className="flex flex-col gap-4">
        {groups.map((group, i) => (
          <div key={i} className="flex flex-col gap-1">
            {group.label && (
              <div className={cn('px-2 pb-1 text-xs font-semibold uppercase tracking-wide', chrome === 'dark' ? 'opacity-60' : 'text-muted-foreground')}>
                {group.label}
              </div>
            )}
            {group.items.map((item) => {
              // Fallback (never hit at runtime, since item.icon is typed as
              // keyof ICONS) only exists to satisfy noUncheckedIndexedAccess
              // — without it this indexes as `LucideIcon | undefined`, which
              // TS correctly refuses to use as a JSX element type.
              const Icon = ICONS[item.icon] ?? CalendarDays
              const active = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium [transition-duration:var(--motion-duration)]',
                    active
                      ? chrome === 'dark'
                        ? 'bg-white/10 border-l-[3px] border-primary'
                        : // was text-primary too — same contrast problem as
                          // the Ghost button. The border-left accent + tinted
                          // fill already carry the "active" signal (doc 20
                          // §9: active state should never be color alone),
                          // so the label can stay text-foreground.
                          'bg-primary/10 border-l-[3px] border-primary text-foreground'
                      : chrome === 'dark'
                        ? 'border-l-[3px] border-transparent opacity-80 hover:bg-white/5 hover:opacity-100'
                        : 'border-l-[3px] border-transparent text-foreground hover:bg-muted',
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.5} />
                  {item.label}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>
    </aside>
  )
}
