import { cache } from 'react'
import { AppError } from '../errors/AppError'
import { createServerClient } from '../supabase/server'
import { resolveEffectivePermissions } from '../permissions/engine'

export interface AuthContext {
  user: { id: string; user_type: string; status: string; email: string | null }
  permissions: Set<string>
  supabaseUid: string
}

/**
 * Every protected Route Handler starts with `const ctx = await withAuth()`.
 * One implementation, reused everywhere — matches 06_Backend_Architecture.md
 * §4.1 verbatim (adapted only to read the client from cookies rather than a
 * raw request, since the Calendar Engine's route handlers are Next.js App
 * Router Route Handlers with cookie-based sessions).
 *
 * v2 merge changes (both additive, neither touches the auth/permission
 * logic above): wrapped in React's `cache()` so a single request's render
 * pass — now that both `app/calendar/layout.tsx` (for the topbar's user
 * chip) and every page under it call `withAuth()` — shares one query
 * instead of running it once per component. `user.email` is threaded
 * through from `supabaseUser.email`, which Supabase Auth always provides,
 * for the same topbar use: showing *something* real about who's signed in
 * without guessing at a `full_name`-shaped column on the real K2 `users`
 * table, which this subsystem was never given a schema for.
 */
export const withAuth = cache(async (): Promise<AuthContext> => {
  const supabase = await createServerClient()
  const {
    data: { user: supabaseUser },
    error,
  } = await supabase.auth.getUser()
  if (error || !supabaseUser) throw new AppError('UNAUTHENTICATED', 401)

  const { data: appUser } = await supabase
    .from('users')
    .select('id, user_type, status')
    .eq('supabase_uid', supabaseUser.id)
    .single()

  if (!appUser) throw new AppError('UNAUTHENTICATED', 401)
  // The real K2 base implementation also rejects a suspended account here
  // (06_Backend_Architecture.md §4.1). Now that this subsystem's standalone
  // bootstrap schema (supabase/standalone/0000_standalone_bootstrap.sql)
  // owns a real `users.status` column — and the real K2 `users` table is
  // expected to expose the same column per that same architecture doc —
  // this check applies in both standalone mode and after a merge into K2.
  if (appUser.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED', 403)

  const permissions = await resolveEffectivePermissions(supabase, appUser.id)
  return {
    user: { ...appUser, email: supabaseUser.email ?? null },
    permissions,
    supabaseUid: supabaseUser.id,
  }
})
