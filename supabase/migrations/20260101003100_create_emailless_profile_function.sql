-- =========================================================
-- UMSUKA IMBALI APP — 0031: create_emailless_profile()
-- =========================================================
-- SECURITY DEFINER function that inserts into profiles and
-- email_aliases in a single transaction, running with the
-- privileges of the function owner (superuser). This bypasses
-- RLS and table-level permission issues that arise when using
-- the service_role key via PostgREST.
--
-- Called from src/lib/auth/admin-create.ts via rpc().

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

-- Grant EXECUTE to service_role (used by the admin client via rpc()).
-- Without this, PostgREST rejects the call even though the function is
-- SECURITY DEFINER, because the calling role (service_role) must have
-- EXECUTE privilege on the function.
grant execute on function umsuka.create_emailless_profile to service_role;
