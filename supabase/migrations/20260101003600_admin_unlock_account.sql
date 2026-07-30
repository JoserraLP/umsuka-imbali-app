-- =========================================================
-- UMSUKA IMBALI APP — 0036: admin_unlock_account
-- =========================================================
-- Permite al super_admin desbloquear manualmente una cuenta
-- que haya sido bloqueada por fuerza bruta, eliminando todos
-- los intentos fallidos registrados para ese perfil.

-- ---------------------------------------------------------
-- 1. Función: limpiar intentos fallidos de un perfil
-- ---------------------------------------------------------
create or replace function umsuka.admin_unlock_account(
    p_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = umsuka, public
as $$
begin
    -- Eliminar todos los intentos fallidos del perfil
    delete from umsuka.password_attempts
    where profile_id = p_profile_id
      and success = false;

    -- También limpiamos tokens de reset expirados o usados
    -- por si el admin quiere generar uno nuevo después
    delete from umsuka.password_reset_tokens
    where profile_id = p_profile_id
      and (used = true or expires_at < now());
end;
$$;

comment on function umsuka.admin_unlock_account is
    'Elimina todos los intentos fallidos de login de un perfil, desbloqueándolo inmediatamente. Solo para uso del super_admin.';

grant execute on function umsuka.admin_unlock_account to service_role;
