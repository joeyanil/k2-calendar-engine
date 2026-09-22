import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

/**
 * Resolves every permission key the given user holds, via roles and any
 * direct per-user grants — mirrors `has_permission()`'s own SQL logic
 * (supabase/dev-fixtures/01_base_k2_schema_stub.sql), fetched once per
 * request and cached on `AuthContext` rather than re-queried per check.
 */
export async function resolveEffectivePermissions(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<Set<string>> {
  // The actual resolution: two queries, mirroring has_permission()'s two
  // EXISTS branches (role-granted, then user-granted directly).
  const [{ data: viaRoles }, { data: viaDirect }] = await Promise.all([
    supabase
      .from('user_roles' as never)
      .select('roles!inner(role_permissions!inner(permissions!inner(resource, action)))')
      .eq('user_id', userId),
    supabase
      .from('user_permissions' as never)
      .select('permissions!inner(resource, action)')
      .eq('user_id', userId),
  ])

  const keys = new Set<string>()
  type PermRow = { resource: string; action: string }
  for (const row of (viaRoles ?? []) as unknown as Array<{ roles: { role_permissions: Array<{ permissions: PermRow }> } }>) {
    for (const rp of row.roles?.role_permissions ?? []) {
      keys.add(`${rp.permissions.resource}.${rp.permissions.action}`)
    }
  }
  for (const row of (viaDirect ?? []) as unknown as Array<{ permissions: PermRow }>) {
    keys.add(`${row.permissions.resource}.${row.permissions.action}`)
  }
  return keys
}

/** The `can()` check every service function calls before a mutation —
 *  never trust the UI to have already enforced this (mission §44). */
export function can(ctx: { permissions: Set<string> }, permissionKey: string): boolean {
  return ctx.permissions.has(permissionKey)
}
