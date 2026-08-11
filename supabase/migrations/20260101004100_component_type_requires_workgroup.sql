-- =========================================================
-- UMSUKA IMBALI APP — 0042: workgroup required for music/dance
-- =========================================================
-- Members whose component type is music or dance MUST belong to a
-- workgroup (telas/barra/estandarte/limpieza). Plain members ("socio/a")
-- have no workgroup requirement and may stay in "ninguno".
--
-- The constraint is added NOT VALID so existing rows are not rejected
-- at migration time. New inserts/updates ARE validated. Once legacy rows
-- are cleaned up (assign a workgroup to every music/dance profile), run:
--   alter table umsuka.profiles validate constraint profiles_component_type_requires_workgroup;

alter table umsuka.profiles
  add constraint profiles_component_type_requires_workgroup
  check (
    component_type = 'member'
    or (workgroup is not null and workgroup <> 'ninguno'::umsuka.workgroup)
  )
  not valid;

comment on constraint profiles_component_type_requires_workgroup on umsuka.profiles is
  'Music and dance members must belong to a workgroup (NOT VALID: legacy rows pending cleanup).';

-- ---------------------------------------------------------
-- create_emailless_profile: explicit error instead of the raw
-- constraint failure when a music/dance account is created without
-- a workgroup.
-- ---------------------------------------------------------
create or replace function umsuka.create_emailless_profile(
  p_id              uuid,
  p_first_name      text,
  p_last_name       text,
  p_username        text,
  p_component_type  text,
  p_alias_email     text,
  p_created_by      uuid,
  p_workgroup       text default null
)
returns void
language plpgsql
security definer
set search_path = umsuka, public
as $$
declare
  v_workgroup umsuka.workgroup;
begin
  if p_component_type in ('music', 'dance')
     and (p_workgroup is null or p_workgroup = '' or p_workgroup = 'ninguno') then
    raise exception 'Música y baile requieren un grupo de trabajo asignado.'
      using errcode = '23514';
  end if;

  -- Convert workgroup text to enum; null if ninguno / not provided
  if p_workgroup is not null and p_workgroup != '' and p_workgroup != 'ninguno' then
    v_workgroup := p_workgroup::umsuka.workgroup;
  else
    v_workgroup := null;
  end if;

  -- Insert profile (upsert in case handle_new_user() trigger already
  -- created a row when the auth user was inserted).
  insert into umsuka.profiles (
    id, first_name, last_name, username, component_type,
    role, status, auth_method, is_active, workgroup
  ) values (
    p_id, p_first_name, p_last_name, p_username, p_component_type,
    'member', 'pending', 'email_alias', true, v_workgroup
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
  'SECURITY DEFINER — inserts a profile + email alias for emailless accounts. Called server-side only.';

grant execute on function umsuka.create_emailless_profile to service_role;
