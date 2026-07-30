-- =========================================================
-- UMSUKA IMBALI APP — 0035: password_reset_tokens
-- =========================================================
-- Tokens de un solo uso para restablecer contraseñas de
-- usuarios sin email (auth_method = email_alias).
-- Generados exclusivamente por super_admin desde el panel
-- de administración.

-- ---------------------------------------------------------
-- 1. Tabla: tokens de restablecimiento
-- ---------------------------------------------------------
create table if not exists umsuka.password_reset_tokens (
    id          uuid primary key default gen_random_uuid(),
    profile_id  uuid not null references umsuka.profiles(id) on delete cascade,
    token_hash  text not null unique,   -- SHA-256 del token raw (nunca almacenamos el raw token)
    expires_at  timestamptz not null,
    used        boolean not null default false,
    used_at     timestamptz,
    created_by  uuid not null references umsuka.profiles(id),
    created_at  timestamptz not null default now()
);

comment on table umsuka.password_reset_tokens is
    'Tokens de un solo uso para restablecer contraseña. Generados por super_admin.';

comment on column umsuka.password_reset_tokens.token_hash is
    'SHA-256 del token generado. El raw token solo se muestra una vez al admin.';
comment on column umsuka.password_reset_tokens.expires_at is
    'Fecha de expiración del token (actualmente 24h desde creación).';
comment on column umsuka.password_reset_tokens.used is
    'true si el token ya fue consumido (one-time use).';

create index if not exists idx_pwd_reset_tokens_profile
    on umsuka.password_reset_tokens (profile_id);

create index if not exists idx_pwd_reset_tokens_hash
    on umsuka.password_reset_tokens (token_hash);

-- ---------------------------------------------------------
-- 2. Grants para service_role
-- ---------------------------------------------------------
grant insert, select, update on umsuka.password_reset_tokens to service_role;

-- ---------------------------------------------------------
-- 3. Función: consumir un token (atómico)
-- ---------------------------------------------------------
-- Marca el token como usado y devuelve el profile_id si
-- el token es válido y no ha expirado. Devuelve NULL si
-- el token es inválido, ya fue usado, o está expirado.
-- Esta función es atómica: si dos llamadas concurrentes
-- intentan consumir el mismo token, solo una tendrá éxito.
create or replace function umsuka.consume_password_reset_token(
    p_token_hash text
)
returns uuid
language plpgsql
security definer
set search_path = umsuka, public
as $$
declare
    v_profile_id uuid;
begin
    -- Intentar marcar como usado (solo si es válido y no expirado)
    update umsuka.password_reset_tokens
    set used = true, used_at = now()
    where token_hash = p_token_hash
      and used = false
      and expires_at > now()
    returning profile_id into v_profile_id;

    return v_profile_id;  -- null si no se actualizó ninguna fila
end;
$$;

comment on function umsuka.consume_password_reset_token is
    'Consume un token de restablecimiento de forma atómica. Devuelve el profile_id si el token es válido, NULL en caso contrario.';

grant execute on function umsuka.consume_password_reset_token to service_role;

-- ---------------------------------------------------------
-- 4. Función: limpiar tokens expirados/usados (mantenimiento)
-- ---------------------------------------------------------
create or replace function umsuka.cleanup_expired_reset_tokens()
returns void
language plpgsql
security definer
set search_path = umsuka, public
as $$
begin
    delete from umsuka.password_reset_tokens
    where expires_at < now() or used = true;
end;
$$;

comment on function umsuka.cleanup_expired_reset_tokens is
    'Elimina tokens expirados o ya usados.';

grant execute on function umsuka.cleanup_expired_reset_tokens to service_role;
