-- =============================================================================
-- LOCAL-VERIFICATION-ONLY FIXTURE — NOT part of any deliverable.
--
-- supabase/dev-fixtures/00_auth_stub.sql already fakes `auth.uid()` for
-- testing against plain local PostgreSQL. It does not create an
-- `auth.users` TABLE, because the original dev-fixture schema
-- (01_base_k2_schema_stub.sql) never had a real foreign key into it.
--
-- supabase/standalone/0000_standalone_bootstrap.sql's `users.supabase_uid`
-- *does* have a real `REFERENCES auth.users(id)` foreign key (a real
-- Supabase project already provides a real `auth.users` table, so this is
-- a genuine, intentional production constraint — see that migration's own
-- comment on the column). Exercising that constraint against plain local
-- PostgreSQL needs *some* `auth.users` table to reference, so this file
-- adds the smallest possible stand-in for it — just enough for the foreign
-- key to resolve, not a reproduction of Supabase Auth's real schema.
--
-- Apply order for local verification only:
--   dev-fixtures/00_auth_stub.sql
--   standalone/local-verification/00_auth_users_test_stub.sql   (this file)
--   standalone/0000_standalone_bootstrap.sql
--   migrations/0001..0014
--   standalone/local-verification/verify_standalone.sql
-- =============================================================================
CREATE TABLE IF NOT EXISTS auth.users (
    id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT
);
