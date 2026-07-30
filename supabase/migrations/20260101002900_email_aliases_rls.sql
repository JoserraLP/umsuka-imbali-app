-- =========================================================
-- UMSUKA IMBALI APP — 0029: email_aliases RLS policies
-- =========================================================
-- The email_aliases table contains internal email aliases that
-- must never be exposed to non-admin users. Only super_admin
-- can read/insert/delete alias records.

-- ---------------------------------------------------------
-- 1. Enable RLS
-- ---------------------------------------------------------
alter table umsuka.email_aliases enable row level security;

-- ---------------------------------------------------------
-- 2. Policies
-- ---------------------------------------------------------
-- Only super_admin can manage email aliases (select, insert,
-- update, delete). Regular users have no access — the alias
-- is resolved server-side via the admin client, not through
-- RLS.
create policy "email_aliases_admin_all"
  on umsuka.email_aliases
  for all
  to authenticated
  using (umsuka.is_super_admin())
  with check (umsuka.is_super_admin());
