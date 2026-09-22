# Standalone Deployment — Patch Notes

This documents the work done to make the Calendar Engine deployable as a
real, independent product (its own Supabase project, its own Vercel
deployment, usable end to end) ahead of the real K2 platform existing to
merge into. Nothing already fixed in `VERIFICATION_PATCH_NOTES.md` was
touched, and none of the 18 migrations in `supabase/migrations/`, the
domain engine, or the test suite were modified — this is purely additive
scaffolding plus the one source change it specifically enables.

## What changed

### 1. New: `supabase/standalone/0000_standalone_bootstrap.sql`

The production-quality replacement for
`supabase/dev-fixtures/01_base_k2_schema_stub.sql`'s simplified `users` /
RBAC tables and `has_permission()` — real constraints, real indexes, real
Row Level Security. `supabase/dev-fixtures/00_auth_stub.sql`'s fake
`auth.uid()`/`auth` schema is **not** reproduced here; a real Supabase
project already provides the genuine thing.

What's actually different from the dev fixture, and why:

- **`users.supabase_uid` is a real foreign key into `auth.users`**
  (`ON DELETE CASCADE`) instead of an unconstrained column — the dev
  fixture had nothing real to reference locally; a real Supabase project
  does.
- **`users.status`** (`'ACTIVE'` / `'SUSPENDED'`, CHECK-constrained) is new
  — it didn't exist in the dev fixture at all. This is what change #3 below
  needed to exist before it could be re-enabled.
- **`has_permission()` gained `SET search_path = public, pg_temp`** on
  itself and on `fn_audit_log()` — both are `SECURITY DEFINER`, and an
  unpinned search_path on a `SECURITY DEFINER` function is a real,
  documented Postgres privilege-escalation vector (a same-named object
  placed earlier in a caller-controlled search path gets called with the
  definer's privileges instead of the intended one). The dev fixture didn't
  need this since it was never going to run in production.
- **`has_permission()` also excludes suspended/deleted users on both
  resolution paths** (role-granted and directly-granted) — defense in
  depth alongside the `withAuth()` check, in case a future code path ever
  calls `has_permission()` (or an RLS policy built on it) without going
  through `withAuth()` first.
- **Row Level Security is enabled on every RBAC table**, not just
  `has_permission()`-adjacent ones. This was the one genuine correctness
  risk in this whole exercise: `src/lib/permissions/engine.ts`'s
  `resolveEffectivePermissions()` queries `user_roles` / `roles` /
  `role_permissions` / `permissions` / `user_permissions` **directly**
  through the request-scoped, RLS-bound client — not only through
  `has_permission()`. Enabling RLS on `users` without also getting these
  policies right would have made every permission check in the app
  silently resolve to an empty set. This is why the verification below
  specifically reproduces `engine.ts`'s own raw queries, not just
  `has_permission()` in isolation.
- **Every junction FK is `ON DELETE CASCADE`, and every FK column has an
  index** (Postgres doesn't index the referencing side of a foreign key
  automatically) — the dev fixture had neither.
- **No new Postgres `ENUM` types were introduced** (e.g. for `status`),
  even though the calendar migrations use them elsewhere for similar
  columns — deliberately, so that deleting this file's tables at merge
  time doesn't also require hunting down a separate `DROP TYPE` (or risk
  colliding with a differently-shaped enum of the same name in the real K2
  schema). A `CHECK` constraint disappears automatically with its table.
- **`user_type` is deliberately left an unconstrained `TEXT` column**,
  exactly as in the dev fixture. K2's real `user_type` taxonomy
  (Admin/Teacher/Registrar/...) isn't this migration's to invent —
  constraining it to a guessed value set would be a design decision
  papered over as an implementation detail. Flagged, not resolved; see
  "What was intentionally left alone" below.

### 2. New: `supabase/standalone/seed_admin.sql`

An idempotent `psql` script (`-v admin_supabase_uid=... -v
admin_full_name=...`) that creates an "Admin" role, grants it every
existing `calendar.*` permission, upserts the `users` row for a given
Supabase Auth UID, and assigns the role. Re-running it is safe (fixes a
typo'd name; picks up any `calendar.*` permission a future migration
adds). This exists because `withAuth()` rejects anyone without a matching
`users` row, and there's intentionally no self-service "become an admin"
API route.

### 3. Changed: `src/lib/auth/withAuth.ts`

Re-enabled the suspended-account check that was previously commented out
with a note that this subsystem didn't own the full `users` row type. It
does now:

```diff
- const { data: appUser } = await supabase
-   .from('users')
-   .select('id, user_type')
+ const { data: appUser } = await supabase
+   .from('users')
+   .select('id, user_type, status')
    .eq('supabase_uid', supabaseUser.id)
    .single()

  if (!appUser) throw new AppError('UNAUTHENTICATED', 401)
- // (omitted: status !== 'ACTIVE' check — subsystem didn't own the users row type)
+ if (appUser.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED', 403)
```

`AuthContext.user`'s type gained the corresponding `status: string` field.
No other call site needed to change — `AuthContext` is only ever
constructed inside `withAuth()` itself.

### 4. New: `DEPLOYMENT.md`, `supabase/standalone/README.md`, and a short
   pointer added to the existing `README.md`

Concrete step-by-step standalone deployment instructions (create Supabase
project → apply bootstrap → apply the 18 migrations → set environment
variables → sign up + seed the first admin → deploy to Vercel), plus a
troubleshooting section for the failure modes seeding gets wrong (401 vs.
403, permissions seeded before Migration 0012 ran, etc.).

### 5. New: `supabase/standalone/local-verification/`

Test-only fixtures (not a deliverable) needed to exercise the above against
plain local PostgreSQL, the same way `supabase/dev-fixtures/` already does
for the 14 calendar migrations themselves — see below.

## How this was verified

Same rigor as the original verification pass, against the **new** schema
end to end, not assumed correct because the dev-fixture version once
worked:

1. Before touching anything: `npm run lint`, `npx tsc --noEmit`, `npx
   vitest run` (135/135), and `npx next build` were all re-confirmed green
   on the untouched repo, and the original dev-fixture flow
   (`00_auth_stub.sql` → `01_base_k2_schema_stub.sql` → all 14 calendar
   migrations) was re-applied to a fresh local PostgreSQL 16 database and
   confirmed to still succeed unchanged.
2. `supabase/standalone/local-verification/00_auth_users_test_stub.sql`
   (test-only) adds the smallest possible `auth.users` table needed to
   exercise `0000_standalone_bootstrap.sql`'s real foreign key against
   plain local Postgres, which has no genuine one.
3. Applied, against a second fresh database, in order:
   `dev-fixtures/00_auth_stub.sql` → the new
   `local-verification/00_auth_users_test_stub.sql` →
   `standalone/0000_standalone_bootstrap.sql` → all 14 files in
   `supabase/migrations/`, unchanged. All 15 files applied cleanly.
4. `supabase/standalone/local-verification/verify_standalone.sql`
   (test-only) then re-ran, against that real database:
   - **Tests 1–9**: the original functional-verification suite's exact
     assertions (RLS blocking an unpermissioned user, the movable-holiday
     hard rule, both exam hard stops, circular-dependency rejection, the
     stale-build race, CLOSED-year protection, and the formal-correction
     RPC) — proving the calendar engine's actual behavior is unchanged
     under the new base schema.
   - **Test A (new)**: a user holding the Admin role but with
     `status = 'SUSPENDED'` is still blocked by `has_permission()` at the
     database layer — the defense-in-depth check, exercised directly.
   - **Tests B/Bb/Bc (new)**: the exact row shape `withAuth()` reads
     (`id, user_type, status`) is reachable through RLS for the correct
     caller and returns `ACTIVE` / `SUSPENDED` correctly, and returns
     **zero rows** for a Supabase Auth identity with no linked `users` row
     (the not-yet-seeded case).
   - **Tests C/Cb/Cc (new)**: `resolveEffectivePermissions()`'s own two raw
     queries — not `has_permission()` — reproduced verbatim against
     `user_roles`/`roles`/`role_permissions`/`permissions` and against
     `user_permissions`/`permissions` directly, confirmed to return the
     correct 7 role-granted keys and the correct 1 directly-granted key,
     respectively, through RLS.
   - **Tests D/Db (new)**: a user with only `calendar.view` (no
     `calendar.manage`) can read `academic_years` but is blocked by RLS
     from inserting one.
   - All 20 assertions passed.
5. `seed_admin.sql` itself was run against that same database: once
   against a fresh Supabase Auth UID (created the Admin role, granted all 7
   `calendar.*` permissions, created and linked the user), a second time
   with a changed name to confirm idempotency (0 new role/permission/
   assignment rows inserted, name updated), and once with no `-v` arguments
   to confirm the missing-variable guard prints a clear message and exits
   without touching the database.
6. Finally, the full gate was re-run from the top on the changed
   application code: `npm run lint`, `npx tsc --noEmit`, `npx vitest run`
   (135/135), and `npx next build` — all green.

## What was intentionally left alone

- **K2's real `user_type` taxonomy.** `0000_standalone_bootstrap.sql`
  leaves `users.user_type` as an unconstrained `TEXT` column, exactly like
  the dev fixture it replaces. Guessing at a value set (Admin/Teacher/
  Registrar/...) and encoding it as a `CHECK` constraint would be inventing
  a K2 design decision this migration has no authority over.
- **Any user-facing profile/contact fields** a real K2 `users` table might
  carry (email, phone, avatar, etc.) that this subsystem never reads are
  not reproduced — adding them here would be guessing at K2's schema, not
  scaffolding this subsystem's own dependencies.
- **The actual data-migration path for moving standalone-mode production
  data into a real K2 once it exists** is out of scope for a schema file to
  automate — it's a one-time project of its own (decide whether to keep
  historical `users.id`s, reconcile K2's real user records against the
  standalone ones, etc.) that depends entirely on decisions the real K2
  schema will need to have already made.
