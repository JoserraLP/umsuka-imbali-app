-- =========================================================
-- UMSUKA IMBALI APP — 0034: service_role SELECT grants
-- =========================================================
-- The admin client (service_role key) is used by server-side code
-- to query tables that regular authenticated users cannot access
-- through RLS (e.g. email_aliases). The service_role bypasses RLS
-- but still requires explicit table-level SELECT grants because
-- it is NOT a superuser in standard Supabase setups.
--
-- Migration 0030 (service_role_grants.sql) already grants INSERT,
-- UPDATE, DELETE on profiles and email_aliases to service_role,
-- but omits SELECT — causing "permission denied for table" errors
-- when reading these tables through the admin client.

-- ---------------------------------------------------------
-- 1. SELECT on umsuka.profiles
-- ---------------------------------------------------------
-- Used by resolveUsernameToEmail() to look up a profile by username.
grant select on table umsuka.profiles to service_role;

-- ---------------------------------------------------------
-- 2. SELECT on umsuka.email_aliases
-- ---------------------------------------------------------
-- Used by resolveUsernameToEmail() to resolve a profile_id to its
-- internal email alias for password-based login.
grant select on table umsuka.email_aliases to service_role;

-- ---------------------------------------------------------
-- 3. SELECT on umsuka.events (future-proof)
-- ---------------------------------------------------------
-- The admin client may need to read events in administrative flows.
grant select on table umsuka.events to service_role;

-- ---------------------------------------------------------
-- 4. SELECT on umsuka.shifts (future-proof)
-- ---------------------------------------------------------
grant select on table umsuka.shifts to service_role;

-- ---------------------------------------------------------
-- 5. SELECT on umsuka.shift_assignments (future-proof)
-- ---------------------------------------------------------
grant select on table umsuka.shift_assignments to service_role;
