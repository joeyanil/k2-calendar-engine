import { Panel } from '../ui/panel'
import { AppError } from '@/lib/errors/AppError'

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof AppError ? error.message : 'Something went wrong loading this page.'
  const code = error instanceof AppError ? error.code : 'UNKNOWN'
  return (
    <Panel title="Couldn't load this page">
      <p className="text-sm text-foreground">{message}</p>
      <p className="mt-1 text-xs text-muted-foreground">Error code: {code}</p>
    </Panel>
  )
}
