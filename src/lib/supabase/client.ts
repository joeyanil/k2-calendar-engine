import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database.types'

/**
 * The browser-side Supabase client. Used only by client components that
 * need to call `supabase.auth.*` directly (sign-in, sign-out) — ordinary
 * data reads/writes go through `createServerClient()` in `server.ts`
 * instead, which is what every service function and RLS policy assumes.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
