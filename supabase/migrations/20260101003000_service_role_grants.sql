-- =========================================================
-- UMSUKA IMBALI APP — 0030: service_role table grants
-- =========================================================
-- The service_role is used by the admin client (server-side code
-- with the service_role key). It needs explicit table-level grants
-- to insert/update/delete rows, since this role is NOT a superuser
-- in standard Supabase local/production setups and the default
-- privileges only cover the `authenticated` role.

-- ---------------------------------------------------------
-- 1. Grants on umsuka.profiles
-- ---------------------------------------------------------
grant insert, update, delete on table umsuka.profiles to service_role;

-- ---------------------------------------------------------
-- 2. Grants on umsuka.email_aliases
-- ---------------------------------------------------------
grant insert, update, delete on table umsuka.email_aliases to service_role;
