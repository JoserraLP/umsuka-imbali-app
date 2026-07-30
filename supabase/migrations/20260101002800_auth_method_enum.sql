-- =========================================================
-- UMSUKA IMBALI APP — 0028: auth_method ENUM & email_aliases
-- =========================================================
-- Allows the super admin to create accounts without an email
-- address (e.g. for minors). The system generates an internal
-- email alias (user-{uuid}@umsuka.internal) used by Supabase
-- Auth, while the member logs in with username + password.

-- ---------------------------------------------------------
-- 1. Create auth_method ENUM (idempotent)
-- ---------------------------------------------------------
do $$ begin
  create type umsuka.auth_method as enum (
    'google', 'email_alias', 'phone'
  );
exception
  when duplicate_object then null;
end $$;

comment on type umsuka.auth_method is
  'How the user authenticates: google (OAuth), email_alias (generated internal email), phone (future).';

-- ---------------------------------------------------------
-- 2. Add columns to umsuka.profiles
-- ---------------------------------------------------------
alter table umsuka.profiles
  add column auth_method umsuka.auth_method not null default 'google';

alter table umsuka.profiles
  add column username text unique;

comment on column umsuka.profiles.auth_method is
  'Authentication method for this profile. Google OAuth by default.';
comment on column umsuka.profiles.username is
  'Optional unique username for email_alias and phone accounts.';

create index if not exists idx_profiles_username on umsuka.profiles (username);

-- ---------------------------------------------------------
-- 3. Create email_aliases table
-- ---------------------------------------------------------
create table if not exists umsuka.email_aliases (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references umsuka.profiles(id) on delete cascade,
  alias_email text not null unique,
  created_by  uuid references umsuka.profiles(id),
  created_at  timestamptz not null default now()
);

comment on table umsuka.email_aliases is
  'Maps umsuka profiles to internally-generated email aliases used for password-based auth.';
comment on column umsuka.email_aliases.alias_email is
  'Format: user-{uuid}@umsuka.internal. Never exposed to any user.';

create index if not exists idx_email_aliases_profile_id on umsuka.email_aliases (profile_id);
create index if not exists idx_email_aliases_alias_email on umsuka.email_aliases (alias_email);

-- ---------------------------------------------------------
-- 4. Update handle_new_user() — set auth_method for OAuth signups
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

  insert into umsuka.profiles (id, first_name, last_name, component_type, role, status, auth_method)
  values (new.id, v_first_name, v_last_name, 'member', 'member', 'pending', 'google')
  on conflict (id) do nothing;

  return new;
end;
$$;
