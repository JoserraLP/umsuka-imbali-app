-- =========================================================
-- UMSUKA IMBALI APP — 0047: workgroup onboarding defaults
-- =========================================================
-- The workgroup column must never be NULL: the middleware decides
-- whether a member needs onboarding by comparing workgroup against
-- 'ninguno', so a NULL would defeat the redirection check.
--
-- 1. Backfill legacy NULL rows to 'ninguno' (no group assigned). ONLY
--    for plain members: music/dance rows are governed by the
--    profiles_component_type_requires_workgroup CHECK (0042), which
--    rejects 'ninguno' for them — setting 'ninguno' on a legacy
--    music/dance row would raise 23514 and abort the migration.
-- 2. Fail fast with an actionable error if any music/dance profile is
--    still missing a workgroup — assign one before deploying. Running
--    this BEFORE the ALTER COLUMN SET NOT NULL guarantees the deploy
--    aborts cleanly instead of half-applying the NOT NULL.
-- 3. Enforce NOT NULL so future writes cannot reintroduce NULLs.
-- 4. Re-tighten create_emailless_profile(): it now converts
--    NULL/''/'ninguno' to 'ninguno' (never inserts NULL) and raises a
--    clear 23514 error when a music/dance account would be created
--    without a workgroup (the profiles_component_type_requires_workgroup
--    constraint stays as the final backstop).

update umsuka.profiles
  set workgroup = 'ninguno'::umsuka.workgroup
  where workgroup is null
    and component_type = 'member';

do $$
declare
  r record;
begin
  for r in
    select id
    from umsuka.profiles
    where workgroup is null
      and component_type in ('music', 'dance')
  loop
    raise exception
      'Perfil % (music/dance) sin grupo de trabajo: asígnalo antes de aplicar esta migración.',
      r.id;
  end loop;
end $$;

alter table umsuka.profiles
  alter column workgroup set not null;

alter table umsuka.profiles
  alter column workgroup set default 'ninguno'::umsuka.workgroup;

comment on column umsuka.profiles.workgroup is
  'Workgroup assignment: telas, barra, estandarte, limpieza, or ninguno (unassigned = onboarding required). Never null.';

-- ---------------------------------------------------------
-- create_emailless_profile v3 (workgroup = 'ninguno', never null)
-- ---------------------------------------------------------
create or replace function umsuka.create_emailless_profile(
    p_id              uuid,
    p_first_name      text,
    p_last_name       text,
    p_username        text,
    p_component_type  text,
    p_alias_email     text,
    p_created_by      uuid,
    p_workgroup       text default null,
    p_status          text default 'pending'
)
returns void
language plpgsql
security definer
set search_path = umsuka, public
as $$
declare
    v_workgroup umsuka.workgroup;
begin
    -- Normalize any "no group" representation to 'ninguno' — the column
    -- is NOT NULL, so we never insert NULL here.
    if p_workgroup is null or p_workgroup = '' or p_workgroup = 'ninguno' then
        v_workgroup := 'ninguno'::umsuka.workgroup;
    else
        v_workgroup := p_workgroup::umsuka.workgroup;
    end if;

    -- Music/dance members MUST have a real workgroup (mirrors the
    -- profiles_component_type_requires_workgroup constraint with a clear
    -- error message instead of the raw constraint failure).
    if p_component_type in ('music', 'dance') and v_workgroup = 'ninguno' then
        raise exception 'Música y baile requieren un grupo de trabajo asignado.'
          using errcode = '23514';
    end if;

    -- Insert profile (upsert in case handle_new_user() trigger already
    -- created a row when the auth user was inserted).
    insert into umsuka.profiles (
        id, first_name, last_name, username, component_type,
        role, status, auth_method, is_active, workgroup
    ) values (
        p_id, p_first_name, p_last_name, p_username, p_component_type,
        'member', p_status::umsuka.user_status, 'email_alias', true, v_workgroup
    )
    on conflict (id) do update set
        first_name      = excluded.first_name,
        last_name       = excluded.last_name,
        username        = excluded.username,
        component_type  = excluded.component_type,
        role            = excluded.role,
        status          = excluded.status,
        auth_method     = excluded.auth_method,
        is_active       = excluded.is_active,
        workgroup       = excluded.workgroup;

    -- Insert email alias (fresh record — no conflict expected)
    insert into umsuka.email_aliases (profile_id, alias_email, created_by)
    values (p_id, p_alias_email, p_created_by);
end;
$$;

comment on function umsuka.create_emailless_profile is
  'SECURITY DEFINER — inserts a profile + email alias for emailless accounts. '
  'Normalizes a missing workgroup to "ninguno" (never NULL) and rejects music/dance '
  'accounts without a workgroup with errcode 23514.';

-- Re-grant execute to service_role (needed after replace)
grant execute on function umsuka.create_emailless_profile to service_role;