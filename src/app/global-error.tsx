'use client'

// Next.js special file: this is the ONLY boundary that can catch an error
// thrown by the root layout itself (src/app/layout.tsx) — a plain
// src/app/error.tsx cannot, since it renders *inside* the root layout.
// Because it replaces the root layout entirely when it activates, it must
// define its own <html>/<body>.
//
// Temporary diagnostic build: shows the real error message/digest/stack
// directly on the page instead of Next's generic redacted crash screen,
// since Cloudflare's and Supabase's own log views haven't shown anything
// for this crash. Safe to strip back down once the real cause is found —
// this repo has no other users to leak details to right now.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'monospace', padding: '2rem', background: '#fff', color: '#111' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Global error boundary caught this:</h1>
        <p style={{ marginTop: '1rem' }}>
          <strong>name:</strong> {error.name}
        </p>
        <p>
          <strong>message:</strong> {error.message || '(empty)'}
        </p>
        <p>
          <strong>digest:</strong> {error.digest ?? '(none)'}
        </p>
        <pre style={{ marginTop: '1rem', whiteSpace: 'pre-wrap', fontSize: '0.8rem', background: '#f4f4f4', padding: '1rem' }}>
          {error.stack ?? '(no stack available)'}
        </pre>
        <button onClick={() => reset()} style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>
          Try again
        </button>
      </body>
    </html>
  )
}
