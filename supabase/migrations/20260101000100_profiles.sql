-- =========================================================
-- UMSUKA IMBALI APP — 0002: profiles
-- =========================================================

create table umsuka.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    first_name text not null,
    last_name text not null,
    birth_date date,
    component_type text not null
        check (
            component_type in (
                'music',
                'dance',
                'member'
            )
        ),
    role text default 'member',
    created_at timestamptz default now()
);

comment on table umsuka.profiles is
  'One row per authenticated member, keyed 1:1 to auth.users. Created automatically on first Google sign-in via umsuka.handle_new_user().';

create index idx_profiles_role on umsuka.profiles (role);
create index idx_profiles_component_type on umsuka.profiles (component_type);
