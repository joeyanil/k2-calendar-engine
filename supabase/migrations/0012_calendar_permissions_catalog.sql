-- =============================================================================
-- Calendar Engine — Migration 0012: Permission Catalog
--
-- Registers the Calendar Engine's permission keys in K2's existing
-- `permissions` table (03_Database_Design.md's RBAC schema, already
-- present from the base migrations). This does NOT create a parallel
-- permission system (mission §45 forbids that) — it adds rows to the same
-- shared catalog every other K2 subsystem registers its own resource.action
-- keys in, resolved by the same has_permission() function everything else
-- already calls.
--
-- Whether any given role (Main Admin, Academic Administrar, Registrar, a
-- custom role, ...) actually HOLDS these permissions is a Main-Admin
-- configuration decision made through K2's existing role/permission
-- management UI (08_Main_Admin_Control_Center.md) — this migration only
-- makes the keys exist to be granted. See IMPLEMENTATION_NOTES.md, "Open
-- question: exact permission key names," for why these specific seven
-- names were chosen and what should be reconciled against the real,
-- already-deployed permission set when this merges into the live system.
-- =============================================================================

INSERT INTO permissions (resource, action) VALUES
    ('calendar', 'view'),
    ('calendar', 'manage'),                 -- academic years, semesters, Student Return
    ('calendar', 'manage_holidays'),
    ('calendar', 'manage_exams'),
    ('calendar', 'manage_dependencies'),
    ('calendar', 'build_timeline'),
    ('calendar', 'correct_history')         -- the "stronger administrative capability" (mission §45)
ON CONFLICT (resource, action) DO NOTHING;
