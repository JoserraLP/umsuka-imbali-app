-- =========================================================
-- UMSUKA IMBALI APP — 0026: user_status ENUM
-- =========================================================
-- Creates a dedicated PostgreSQL ENUM for profile registration
-- status. New users start as 'pending' until a super_admin
-- explicitly approves them.

-- ---------------------------------------------------------
-- 1. Create ENUM (idempotent)
-- ---------------------------------------------------------
do $$ begin
  create type umsuka.user_status as enum (
    'pending', 'active', 'suspended'
  );
exception
  when duplicate_object then null;
end $$;

comment on type umsuka.user_status is
  'User account status: pending (awaiting admin approval), active (approved), suspended (blocked by admin).';

-- ---------------------------------------------------------
-- 2. Add status column to umsuka.profiles
-- ---------------------------------------------------------
alter table umsuka.profiles
  add column status umsuka.user_status not null default 'pending';

comment on column umsuka.profiles.status is
  'Registration approval status. Pending users cannot access app features until a super_admin activates them.';

-- ---------------------------------------------------------
-- 3. Set all existing profiles to 'active' so pre-migration
--    users are not locked out.
-- ---------------------------------------------------------
update umsuka.profiles set status = 'active' where status is null or status = 'pending';

-- ---------------------------------------------------------
-- 4. Create index
-- ---------------------------------------------------------
create index if not exists idx_profiles_status on umsuka.profiles (status);

-- ---------------------------------------------------------
-- 5. Update handle_new_user() — insert with status = 'pending'
-- ---------------------------------------------------------
create or replace function umsuka.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = umsuka, public
as $$
declare
  v_full_name text;
  v_first_name text;
  v_last_name text;
begin
  v_full_name := trim(
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      ''
    )
  );

  v_first_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'given_name'), ''),
    nullif(split_part(v_full_name, ' ', 1), ''),
    'New'
  );

  v_last_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'family_name'), ''),
    nullif(trim(substring(v_full_name from length(split_part(v_full_name, ' ', 1)) + 1)), ''),
    'Member'
  );

  insert into umsuka.profiles (id, first_name, last_name, component_type, role, status)
  values (new.id, v_first_name, v_last_name, 'member', 'member', 'pending')
  on conflict (id) do nothing;

  return new;
end;
$$;
