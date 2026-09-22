-- =============================================================================
-- DEV-ONLY FIXTURE — a minimal stand-in for the K2 base schema that already
-- exists before the Calendar Engine is added (03_Database_Design.md Migrations
-- 001-003, 011, 012, 015; 07_Authentication_Authorization.md §8).
--
-- NOT part of the Calendar Engine's deliverable. In the real K2 codebase
-- these tables/functions are already there; the Calendar Engine's migrations
-- (supabase/migrations/) only ever reference them (`has_permission()`,
-- `fn_update_timestamp()`, `fn_audit_log()`, `users`), never redefine them.
-- This stub reproduces just enough of them, byte-for-byte where it matters
-- (`has_permission()`'s signature and resolution logic), so that the real
-- migrations can be applied and tested against a plain local PostgreSQL
-- instance instead of a live K2 project.
-- =============================================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supabase_uid UUID UNIQUE,
    full_name TEXT NOT NULL,
    user_type TEXT NOT NULL DEFAULT 'ADMIN',
    deleted_at TIMESTAMPTZ
);

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource TEXT NOT NULL,
    action TEXT NOT NULL,
    UNIQUE (resource, action)
);

CREATE TABLE role_permissions (
    role_id UUID REFERENCES roles(id),
    permission_id UUID REFERENCES permissions(id),
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
    user_id UUID REFERENCES users(id),
    role_id UUID REFERENCES roles(id),
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE user_permissions (
    user_id UUID REFERENCES users(id),
    permission_id UUID REFERENCES permissions(id),
    PRIMARY KEY (user_id, permission_id)
);

-- Exact resolution logic from 03_Database_Design.md's "Migration 015" listing.
CREATE OR REPLACE FUNCTION has_permission(p_permission_key TEXT) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE u.supabase_uid = auth.uid()
      AND (p.resource || '.' || p.action) = p_permission_key
  ) OR EXISTS (
    SELECT 1
    FROM users u
    JOIN user_permissions up ON up.user_id = u.id
    JOIN permissions p ON p.id = up.permission_id
    WHERE u.supabase_uid = auth.uid()
      AND (p.resource || '.' || p.action) = p_permission_key
  );
$$;

REVOKE ALL ON FUNCTION has_permission FROM PUBLIC;
GRANT EXECUTE ON FUNCTION has_permission TO authenticated;

-- fn_update_timestamp() — Migration 012, verbatim.
CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- audit_logs + fn_audit_log() — Migration 010/011, verbatim shape.
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES users(id),
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    old_value JSONB,
    new_value JSONB,
    reason TEXT,
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, anon;

CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, old_value, new_value, created_at)
        VALUES (COALESCE(current_setting('app.current_user_id', true)::UUID, NULL), TG_OP, TG_TABLE_NAME,
                OLD.id::TEXT, row_to_json(OLD)::JSONB, row_to_json(NEW)::JSONB, NOW());
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, old_value, created_at)
        VALUES (COALESCE(current_setting('app.current_user_id', true)::UUID, NULL), TG_OP, TG_TABLE_NAME,
                OLD.id::TEXT, row_to_json(OLD)::JSONB, NOW());
        RETURN OLD;
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, new_value, created_at)
        VALUES (COALESCE(current_setting('app.current_user_id', true)::UUID, NULL), TG_OP, TG_TABLE_NAME,
                NEW.id::TEXT, row_to_json(NEW)::JSONB, NOW());
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT SELECT, INSERT, UPDATE ON users, roles, permissions, role_permissions, user_roles, user_permissions
  TO authenticated, service_role;
GRANT INSERT ON audit_logs TO service_role;
