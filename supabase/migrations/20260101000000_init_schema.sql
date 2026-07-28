-- =========================================================
-- UMSUKA IMBALI APP — 0001: schema bootstrap
-- =========================================================
-- All business objects live in the `umsuka` schema, never in `public`.
-- Grants are scoped to the roles Supabase uses to service API requests
-- (anon = unauthenticated, authenticated = signed-in users). Table-level
-- access is further restricted by RLS policies (see migration 1300).

create schema if not exists umsuka;

grant usage on schema umsuka to anon, authenticated, service_role;

-- Ensure future tables created in this schema are still reachable by the
-- API roles (actual row access remains governed by RLS).
alter default privileges in schema umsuka
  grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema umsuka
  grant usage, select on sequences to authenticated;

-- pgcrypto provides gen_random_uuid(), used as the default for every
-- surrogate primary key in this schema.
create extension if not exists pgcrypto;
