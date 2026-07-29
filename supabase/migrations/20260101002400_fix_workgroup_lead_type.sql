-- =========================================================
-- UMSUKA IMBALI APP — 0025: fix is_workgroup_lead comparison
-- =========================================================
--
-- PROBLEM
-- After migrating profiles.workgroup to the umsuka.workgroup
-- ENUM, comparisons inside is_workgroup_lead() fail with:
--   operator does not exist: workgroup = text
--
-- ROOT CAUSE
-- PostgreSQL cannot implicitly compare a `umsuka.workgroup`
-- ENUM column with a `text` value using `=`. An explicit
-- cast to the ENUM is required.
--
-- WHY NOT CHANGE THE PARAMETER TYPE?
-- `CREATE OR REPLACE FUNCTION` with a different signature
-- creates an overload instead of replacing the old function.
-- The old `is_workgroup_lead(text)` would persist and RLS
-- policies might still bind to it.
--
-- SOLUTION
-- Keep the `text` signature but cast the parameter to the
-- ENUM type inside the function body.

-- ---------------------------------------------------------
-- 1. Recreate with same text param + internal cast to ENUM
--    (CREATE OR REPLACE works because the signature is
--     identical to the original — text parameter)
-- ---------------------------------------------------------
create or replace function umsuka.is_workgroup_lead(check_workgroup text)
returns boolean
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select coalesce(
    (select is_workgroup_lead
       from umsuka.profiles
      where id = auth.uid()
        and workgroup = check_workgroup::umsuka.workgroup),
    false
  );
$$;

comment on function umsuka.is_workgroup_lead(text) is
  'Returns true if the current user is the lead of the given workgroup.';

grant execute on function umsuka.is_workgroup_lead(text) to authenticated;

-- ---------------------------------------------------------
-- 3. current_user_workgroup stays as-is (returns text,
--    implicit ENUM→text cast works for function returns)
-- ---------------------------------------------------------
