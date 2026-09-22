import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-bold text-foreground">K2 Academic Calendar Engine</h1>
      <p className="text-sm text-muted-foreground">
        This subsystem is normally reached from the K2 Main Admin Portal. For local development, jump straight in:
      </p>
      <Link href="/calendar" className="text-sm font-medium text-primary underline underline-offset-4">
        Open the Calendar console →
      </Link>
    </main>
  )
}
