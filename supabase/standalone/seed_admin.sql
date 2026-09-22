-- =============================================================================
-- STANDALONE-MODE SCAFFOLDING — provisions the first admin user.
--
-- `withAuth()` rejects any signed-in Supabase Auth user who doesn't already
-- have a matching row in `users` (supabase/standalone/0000_standalone_
-- bootstrap.sql) — there is no self-service "become an admin" flow, by
-- design. Run this once, after the bootstrap migration and all 14 calendar
-- migrations have been applied, to create that first row.
--
-- PREREQUISITE: the person must already have signed up through Supabase
-- Auth once (e.g. the app's own sign-up screen, or Supabase Studio's
-- Authentication → Users → "Add user") so an `auth.users` row — and
-- therefore a real auth UID — already exists. This script only creates the
-- *application-level* `users` row and grants it every `calendar.*`
-- permission; it does not create the Auth identity itself.
--
-- USAGE (from a terminal with `psql` and the project's connection string):
--
--   psql "$DATABASE_URL" \
--     -v admin_supabase_uid="<the auth.users.id UUID from Supabase Studio>" \
--     -v admin_full_name="Jane Doe" \
--     -f supabase/standalone/seed_admin.sql
--
-- Safe to re-run: every step is idempotent (upsert on `users.supabase_uid`,
-- `ON CONFLICT DO NOTHING` everywhere else), so re-running it after adding
-- a new `calendar.*` permission in a future migration simply grants the
-- Admin role whatever new key it's missing.
-- =============================================================================
\set ON_ERROR_STOP on
\pset pager off

\if :{?admin_supabase_uid}
\else
  \warn 'Missing -v admin_supabase_uid=<uuid>. See the header of this file for usage.'
  \quit
\endif

\if :{?admin_full_name}
\else
  \warn 'Missing -v admin_full_name="Full Name". See the header of this file for usage.'
  \quit
\endif

BEGIN;

-- 1. The "Admin" role — created once, then just re-used on every re-run.
INSERT INTO roles (name, description)
VALUES ('Admin', 'Standalone-mode bootstrap role: every calendar.* permission.')
ON CONFLICT (name) DO NOTHING;

-- 2. Grant it every calendar.* permission that exists right now (Migration
--    0012 must already have run). Re-running this script after a future
--    migration adds a new calendar.* key picks that key up automatically.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'Admin'
  AND p.resource = 'calendar'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 3. The application-level `users` row, linked to the Supabase Auth
--    identity by `supabase_uid`. Upserted so re-running this script (e.g.
--    to fix a typo'd name) doesn't create a duplicate.
INSERT INTO users (supabase_uid, full_name, user_type, status)
VALUES (:'admin_supabase_uid'::UUID, :'admin_full_name', 'ADMIN', 'ACTIVE')
ON CONFLICT (supabase_uid)
DO UPDATE SET full_name = EXCLUDED.full_name, status = 'ACTIVE', deleted_at = NULL;

-- 4. Assign the Admin role to that user.
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
CROSS JOIN roles r
WHERE u.supabase_uid = :'admin_supabase_uid'::UUID
  AND r.name = 'Admin'
ON CONFLICT (user_id, role_id) DO NOTHING;

COMMIT;

-- Sanity check — should print exactly one row with every calendar.* key.
SELECT u.full_name, u.status, array_agg(p.resource || '.' || p.action ORDER BY p.action) AS calendar_permissions
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON r.id = ur.role_id AND r.name = 'Admin'
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id AND p.resource = 'calendar'
WHERE u.supabase_uid = :'admin_supabase_uid'::UUID
GROUP BY u.full_name, u.status;
