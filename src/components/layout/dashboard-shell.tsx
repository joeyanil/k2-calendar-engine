import type { ReactNode } from 'react'
import { Sidebar, type NavGroup } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'

export function DashboardShell({
  title,
  userLabel,
  userSubLabel,
  groups,
  chrome = 'surface',
  children,
}: {
  title: string
  userLabel: string
  userSubLabel?: string
  groups: NavGroup[]
  chrome?: 'dark' | 'surface'
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar title={title} groups={groups} chrome={chrome} />
      <div className="flex flex-1 flex-col">
        <Topbar userLabel={userLabel} userSubLabel={userSubLabel} chrome={chrome} />
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  )
}
