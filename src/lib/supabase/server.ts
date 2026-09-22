import { createServerClient as createSupabaseServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database.types'

/**
 * The request-scoped Supabase client — reads/writes the session from
 * cookies, subject to RLS for whichever user is signed in. This is the
 * client every service function should use for ordinary reads/writes;
 * every calendar_* table's row-level security policy depends on
 * `auth.uid()` resolving correctly, which only happens through this client.
 */
export async function createServerClient() {
  const cookieStore = await cookies()

  return createSupabaseServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Called from a Server Component that can't set cookies — safe
            // to ignore as long as middleware refreshes the session.
          }
        },
      },
    },
  )
}
