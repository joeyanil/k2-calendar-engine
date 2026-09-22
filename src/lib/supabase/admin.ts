import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

/**
 * Service-role client — bypasses RLS entirely (matches the `service_role`
 * Postgres role granted BYPASSRLS in supabase/dev-fixtures and every
 * `GRANT ALL ... TO service_role` in the Calendar Engine migrations).
 *
 * Used ONLY by: the daily reminder job (reminders.ts's scheduling logic
 * needs to read/write across all years, not just what the calling user can
 * see) and the timeline-rebuild background job. NEVER import this into a
 * Route Handler that hasn't already run `withAuth` + a permission check —
 * this client has no concept of "the current user" at all.
 */
export function createAdminClient() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
