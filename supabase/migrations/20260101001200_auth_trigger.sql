-- =========================================================
-- UMSUKA IMBALI APP — 0013: automatic profile provisioning
-- =========================================================
-- BREAKING-CHANGE NOTE (non-breaking, additive):
-- umsuka.profiles.component_type is NOT NULL with no default in the
-- source-of-truth schema. A brand-new Google sign-in has no way to supply
-- a component_type up front, so umsuka.handle_new_user() below needs a
-- value to insert. We add a DEFAULT of 'member' (already a valid value
-- per the existing CHECK constraint) — the column stays NOT NULL, the
-- CHECK constraint is untouched, and every existing row is unaffected.
-- Members can change their component_type afterwards from their profile
-- once the Members module is implemented.
alter table umsuka.profiles
  alter column component_type set default 'member';

-- ---------------------------------------------------------
-- handle_new_user(): provisions a umsuka.profiles row the moment a new
-- auth.users row is created (i.e. on first successful Google OAuth
-- sign-in). Runs as SECURITY DEFINER because the authenticated/anon
-- roles have no INSERT grant on auth.users-triggered writes otherwise,
-- and because this must succeed atomically with user creation.
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

  insert into umsuka.profiles (id, first_name, last_name, component_type, role)
  values (new.id, v_first_name, v_last_name, 'member', 'member')
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function umsuka.handle_new_user() is
  'Auto-provisions a umsuka.profiles row from Google OAuth metadata when a new auth.users row is created.';

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function umsuka.handle_new_user();
