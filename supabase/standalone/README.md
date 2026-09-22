# `supabase/standalone/`

Scaffolding that lets the Calendar Engine run as its own, independent
product before the real K2 platform exists to merge into. None of this is
part of the Calendar Engine itself — see `DEPLOYMENT.md` at the repo root
for how to use it, and `0000_standalone_bootstrap.sql`'s own header for
exactly what to do with it once merging into a real K2 becomes possible.

| File | What it is |
|---|---|
| `0000_standalone_bootstrap.sql` | **Deliverable.** The production-quality base schema (`users`, roles/permissions, `has_permission()`, `audit_logs`) this subsystem needs — apply it before the 18 migrations in `supabase/migrations/`. |
| `seed_admin.sql` | **Deliverable.** Idempotent script to provision the first admin user after deploy. |
| `local-verification/` | **Not a deliverable.** The fixtures used to verify `0000_standalone_bootstrap.sql` against plain local PostgreSQL (this sandbox has no Docker/Supabase CLI) — mirrors the role `supabase/dev-fixtures/` already plays for the 14 calendar migrations themselves. |

`local-verification/00_auth_users_test_stub.sql` exists only because
`0000_standalone_bootstrap.sql` adds a real foreign key from `users` into
`auth.users` — a real Supabase project already provides that table; plain
local PostgreSQL doesn't, so this stands in the smallest possible version
of it purely so that constraint can be exercised locally.

`local-verification/verify_standalone.sql` re-runs every check from
`supabase/dev-fixtures/02_functional_verification.sql` against the new
schema, plus new checks specific to what actually changed: the suspended-
account check enforced at the database layer (not just in `withAuth()`),
and `src/lib/permissions/engine.ts`'s own raw permission-resolution queries
— not just `has_permission()` — actually returning the right result through
Row Level Security.
