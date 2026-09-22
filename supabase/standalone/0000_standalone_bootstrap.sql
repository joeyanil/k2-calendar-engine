-- =============================================================================
-- STANDALONE-MODE SCAFFOLDING — replace with real K2's schema when merging.
--
-- This file does NOT belong to the Calendar Engine's 14 deliverable
-- migrations (supabase/migrations/). It exists only so this subsystem can be
-- deployed and run as its own, independent Supabase project — one real
-- Supabase project, one Vercel deployment, fully usable end to end — before
-- the real K2 platform exists to merge into.
--
-- It is the production-quality replacement for the two throwaway dev
-- fixtures used during the engine's own test verification
-- (supabase/dev-fixtures/00_auth_stub.sql, 01_base_k2_schema_stub.sql):
--
--   * 00_auth_stub.sql faked Supabase's OWN `auth` schema (`auth.users`,
--     `auth.uid()`) — needed only because that testing ran against plain
--     local PostgreSQL with no Docker/Supabase platform available. A real
--     Supabase project already provides genuine `auth.users` / `auth.uid()`
--     from its own GoTrue-backed `auth` schema. This migration does NOT
--     recreate, redefine, or shadow anything in the `auth` schema — it only
--     ever references `auth.users` / `auth.uid()` as given.
--
--   * 01_base_k2_schema_stub.sql's simplified `users` / RBAC tables and
--     `has_permission()` are turned into the real thing below: real
--     constraints, real indexes, real Row Level Security, and a permission
--     model that resolves against whatever the Calendar Engine's own
--     Migration 0012 (`0012_calendar_permissions_catalog.sql`) registers —
--     not a hand-simplified test version of it.
--
-- Apply this BEFORE the 14 migrations in supabase/migrations/ — they assume
-- `users`, `has_permission()`, `fn_update_timestamp()`, `fn_audit_log()`, and
-- `audit_logs` already exist, exactly as the real K2 platform's own base
-- migrations would already have provided them.
--
-- WHEN MERGING INTO REAL K2: this whole file's tables/functions get
-- replaced by K2's real equivalents (with a real data-migration pass for
-- any standalone-mode production data — a one-time project of its own, not
-- something a schema file can automate away). Deliberately NOT reproduced
-- here, because the real K2 schema owns it and inventing it would just be
-- another simplification to later un-pick: K2's actual `user_type` value
-- set/taxonomy (kept as an unconstrained TEXT column below — see its
-- comment) and any user-facing profile/contact fields K2's real `users`
-- table carries that this subsystem never reads.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- users
--
-- `supabase_uid` is a real foreign key into Supabase Auth's own
-- `auth.users` (ON DELETE CASCADE: if the underlying auth identity is
-- removed, its application-level profile row goes with it — deactivating
-- someone should go through `status` / `deleted_at` below, not deleting
-- the auth user out from under an otherwise-active profile).
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supabase_uid  UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name     TEXT NOT NULL CHECK (btrim(full_name) <> ''),
    -- K2's real `user_type` taxonomy (Admin/Teacher/Registrar/...) lives in
    -- the real base schema this stands in for; left unconstrained here
    -- rather than guessing at values this migration has no authority over.
    user_type     TEXT NOT NULL DEFAULT 'ADMIN',
    -- Backs the suspended-account check in `src/lib/auth/withAuth.ts`
    -- (06_Backend_Architecture.md §4.1). A real Postgres ENUM was
    -- deliberately avoided for this column: an ENUM is a separate schema
    -- object that would need its own explicit `DROP TYPE` (and could
    -- collide with a differently-shaped enum of the same name in the real
    -- K2 schema) when this file is retired at merge time, whereas a CHECK
    -- constraint disappears automatically with the table.
    status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Common access patterns: "who is active", "who is suspended", and
-- excluding soft-deleted rows without a sequential scan.
CREATE INDEX idx_users_status ON users (status);
CREATE INDEX idx_users_not_deleted ON users (id) WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- roles / permissions / role_permissions / user_roles / user_permissions
--
-- Same two-path model as the dev fixture (role-granted, or granted
-- directly to a user) — the model itself isn't being redesigned, only
-- hardened: NOT NULL + ON DELETE CASCADE on every junction FK (an orphaned
-- junction row referencing a deleted role/permission/user is never a valid
-- state), plus indexes on every FK column (Postgres does not automatically
-- index the referencing side of a foreign key, only the referenced side).
-- -----------------------------------------------------------------------------
CREATE TABLE roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE CHECK (btrim(name) <> ''),
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE permissions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource    TEXT NOT NULL CHECK (btrim(resource) <> ''),
    action      TEXT NOT NULL CHECK (btrim(action) <> ''),
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (resource, action)
);

CREATE TABLE role_permissions (
    role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX idx_role_permissions_permission_id ON role_permissions (permission_id);

CREATE TABLE user_roles (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id    UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);
CREATE INDEX idx_user_roles_role_id ON user_roles (role_id);

CREATE TABLE user_permissions (
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, permission_id)
);
CREATE INDEX idx_user_permissions_permission_id ON user_permissions (permission_id);

-- -----------------------------------------------------------------------------
-- fn_update_timestamp() — verbatim name/behavior the 14 calendar migrations
-- already call as their own `updated_at` trigger function. Defined here
-- (rather than in each table's own migration) since `users` and `roles`
-- need it too, and it must exist exactly once.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- -----------------------------------------------------------------------------
-- audit_logs — same immutable-ledger shape as the dev fixture, with real
-- indexes for the two ways it actually gets queried (by resource, and by
-- recency). `actor_id` is intentionally left ON DELETE NO ACTION (the
-- default): users are soft-deleted (`users.deleted_at`), never hard-deleted,
-- specifically so an audit trail's `actor_id` never needs to be nulled out
-- or ever blocks a user row from being removed.
-- -----------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id      UUID REFERENCES users(id),
    action        TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id   TEXT,
    old_value     JSONB,
    new_value     JSONB,
    reason        TEXT,
    ip_address    INET,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_logs_resource ON audit_logs (resource_type, resource_id);
CREATE INDEX idx_audit_logs_actor_id ON audit_logs (actor_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at DESC);

CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, old_value, new_value, created_at)
        VALUES (NULLIF(current_setting('app.current_user_id', true), '')::UUID, TG_OP, TG_TABLE_NAME,
                OLD.id::TEXT, row_to_json(OLD)::JSONB, row_to_json(NEW)::JSONB, NOW());
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, old_value, created_at)
        VALUES (NULLIF(current_setting('app.current_user_id', true), '')::UUID, TG_OP, TG_TABLE_NAME,
                OLD.id::TEXT, row_to_json(OLD)::JSONB, NOW());
        RETURN OLD;
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, new_value, created_at)
        VALUES (NULLIF(current_setting('app.current_user_id', true), '')::UUID, TG_OP, TG_TABLE_NAME,
                NEW.id::TEXT, row_to_json(NEW)::JSONB, NOW());
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- has_permission(p_permission_key TEXT) — the one function every RLS policy
-- and RPC guard in the 14 calendar migrations calls. Same two-path
-- resolution as the dev fixture (role-granted OR user-granted), hardened
-- for production:
--
--   * `SET search_path = public, pg_temp` — a SECURITY DEFINER function
--     without a pinned search_path can be hijacked by a same-named object
--     placed earlier in a caller-controlled search_path (the Postgres
--     manual's own documented risk for SECURITY DEFINER functions); the
--     dev fixture omitted this since it was never meant to be production
--     code.
--   * `AND u.deleted_at IS NULL AND u.status = 'ACTIVE'` on both branches —
--     defense in depth. `withAuth()` already rejects a suspended user
--     before any permission check runs, but a suspended/deleted account
--     must never be treated as holding a permission at the database layer
--     either, in case a future code path calls `has_permission()` (or an
--     RLS policy built on it) without going through `withAuth()` first.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION has_permission(p_permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE u.supabase_uid = auth.uid()
      AND u.deleted_at IS NULL
      AND u.status = 'ACTIVE'
      AND (p.resource || '.' || p.action) = p_permission_key
  ) OR EXISTS (
    SELECT 1
    FROM users u
    JOIN user_permissions up ON up.user_id = u.id
    JOIN permissions p ON p.id = up.permission_id
    WHERE u.supabase_uid = auth.uid()
      AND u.deleted_at IS NULL
      AND u.status = 'ACTIVE'
      AND (p.resource || '.' || p.action) = p_permission_key
  );
$$;

REVOKE ALL ON FUNCTION has_permission(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION has_permission(TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security.
--
-- `src/lib/permissions/engine.ts`'s `resolveEffectivePermissions()` queries
-- `user_roles` / `roles` / `role_permissions` / `permissions` /
-- `user_permissions` DIRECTLY through the request-scoped (RLS-bound, anon
-- key) Supabase client — not only through `has_permission()` — so these
-- tables need their own real RLS policies, or that function silently
-- resolves an empty permission set on every request and every permission
-- check in the app fails closed. This is exactly the kind of gap this
-- migration's own functional verification (supabase/standalone/verify_
-- standalone.sql) exercises directly, not just via has_permission().
--
-- `roles` / `permissions` / `role_permissions` are catalog-shaped (which
-- roles and permissions exist, and what a role grants) rather than
-- per-user secrets, so — mirroring the exact convention the calendar
-- migrations themselves already use for `holiday_types` / `exam_types`
-- (0001_calendar_types_and_catalogs.sql) — they're readable by any
-- authenticated user and writable by nobody through the API. `users` /
-- `user_roles` / `user_permissions` carry actual per-user assignment data,
-- so each user may only read their own rows; provisioning new
-- users/roles/assignments is an administrative operation performed via the
-- service-role client (see supabase/standalone/seed_admin.sql) — the same
-- way Migration 0012's own header describes real role/permission
-- assignment as "a Main-Admin configuration decision," not a self-service
-- API call.
-- -----------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_select_own ON users
    FOR SELECT TO authenticated
    USING (supabase_uid = auth.uid() AND deleted_at IS NULL);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY roles_select_authenticated ON roles FOR SELECT TO authenticated USING (TRUE);

ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY permissions_select_authenticated ON permissions FOR SELECT TO authenticated USING (TRUE);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_select_authenticated ON role_permissions FOR SELECT TO authenticated USING (TRUE);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_roles_select_own ON user_roles
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM users u WHERE u.id = user_roles.user_id AND u.supabase_uid = auth.uid()));

ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_permissions_select_own ON user_permissions
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM users u WHERE u.id = user_permissions.user_id AND u.supabase_uid = auth.uid()));

-- audit_logs: deny-by-default for both anon and authenticated. Rows are
-- written exclusively by fn_audit_log() (SECURITY DEFINER, so it writes
-- regardless of the calling role's own grants/RLS), and read exclusively
-- by the service-role client for future admin/compliance tooling.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, anon;

-- -----------------------------------------------------------------------------
-- Table-level grants (RLS defines which ROWS a role sees; Postgres
-- separately requires the table-level privilege to query the table at
-- all — see 0014_calendar_table_grants.sql's own header for the identical
-- reasoning applied there to the calendar tables).
-- -----------------------------------------------------------------------------
GRANT SELECT ON users, roles, permissions, role_permissions, user_roles, user_permissions TO authenticated;
GRANT ALL ON users, roles, permissions, role_permissions, user_roles, user_permissions TO service_role;
GRANT SELECT, INSERT ON audit_logs TO service_role;
