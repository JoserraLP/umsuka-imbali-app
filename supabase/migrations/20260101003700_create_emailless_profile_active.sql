-- =========================================================
-- UMSUKA IMBALI APP — 0037: create_emailless_profile v2
-- =========================================================
-- Actualiza la función para aceptar un parámetro p_status,
-- permitiendo que el super_admin cree cuentas directamente
-- activas (status = 'active') en lugar de tener que aprobarlas
-- después manualmente.
--
-- Cuando el super_admin crea una cuenta desde el panel, se
-- pasa 'active' como status. El valor por defecto 'pending'
-- mantiene compatibilidad con llamadas existentes.

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
    'Accepts p_status (default pending) para que el super_admin cree cuentas activas.';

-- Re-grant execute to service_role (needed after replace)
grant execute on function umsuka.create_emailless_profile to service_role;
