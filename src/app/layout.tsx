import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'K2 — Academic Calendar Engine',
  description: 'The K2 Academic Calendar Engine administrative console.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // This subsystem is Admin/Registrar-only end to end (see the merge
  // decision note in globals.css) — data-portal is set once here, at the
  // root, rather than per-route, since there's no other portal content
  // anywhere in this app for it to vary by.
  return (
    <html lang="en" data-portal="admin">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">{children}</body>
    </html>
  )
}
