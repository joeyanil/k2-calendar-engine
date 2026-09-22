'use client'

// Backstop for anything under the root layout (everywhere except the root
// layout itself, which only global-error.tsx can catch). Same temporary
// diagnostic purpose — see global-error.tsx's comment.
export default function RootSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Route error boundary caught this:</h1>
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
    </div>
  )
}
