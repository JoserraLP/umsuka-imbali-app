-- =========================================================
-- UMSUKA IMBALI APP — 0034: password_attempts (rate limit)
-- =========================================================
-- Tabla para registrar intentos de login y prevenir ataques
-- de fuerza bruta. Se usa con funciones RPC para verificar
-- si un perfil está bloqueado y registrar nuevos intentos.

-- ---------------------------------------------------------
-- 1. Tabla: registro de intentos de login
-- ---------------------------------------------------------
create table if not exists umsuka.password_attempts (
    id          bigint generated always as identity primary key,
    profile_id  uuid not null references umsuka.profiles(id) on delete cascade,
    success     boolean not null,
    ip_address  inet,
    created_at  timestamptz not null default now()
);

comment on table umsuka.password_attempts is
    'Registro de intentos de inicio de sesión para protección contra fuerza bruta.';

comment on column umsuka.password_attempts.profile_id is
    'Perfil que intentó iniciar sesión.';
comment on column umsuka.password_attempts.success is
    'true si el login fue exitoso, false si falló.';
comment on column umsuka.password_attempts.ip_address is
    'Dirección IP desde la que se hizo el intento (opcional, para análisis posteriores).';

create index if not exists idx_pwd_attempts_profile_created
    on umsuka.password_attempts (profile_id, created_at desc);

-- ---------------------------------------------------------
-- 2. Grants para service_role
-- ---------------------------------------------------------
grant insert, select on umsuka.password_attempts to service_role;

-- ---------------------------------------------------------
-- 3. Función: verificar si un perfil está bloqueado
-- ---------------------------------------------------------
-- Un perfil se considera bloqueado cuando ha tenido
-- p_max_attempts intentos fallidos en los últimos
-- p_window_minutes minutos. El bloqueo dura p_block_minutes
-- desde el último intento fallido.
create or replace function umsuka.is_login_blocked(
    p_profile_id     uuid,
    p_max_attempts   int default 5,
    p_window_minutes int default 15,
    p_block_minutes  int default 30
)
returns boolean
language plpgsql
security definer
set search_path = umsuka, public
as $$
declare
    v_failed_attempts int;
    v_last_failed     timestamptz;
begin
    -- Contar intentos fallidos en la ventana de tiempo
    select count(*)
    into v_failed_attempts
    from umsuka.password_attempts
    where profile_id = p_profile_id
      and success = false
      and created_at > now() - (p_window_minutes || ' minutes')::interval;

    -- Si no se alcanzó el límite, no está bloqueado
    if v_failed_attempts < p_max_attempts then
        return false;
    end if;

    -- Obtener el intento fallido más reciente
    select created_at into v_last_failed
    from umsuka.password_attempts
    where profile_id = p_profile_id and success = false
    order by created_at desc
    limit 1;

    -- Si el último fallo está dentro del bloqueo, está bloqueado
    if v_last_failed is not null
       and v_last_failed > now() - (p_block_minutes || ' minutes')::interval then
        return true;
    end if;

    return false;
end;
$$;

comment on function umsuka.is_login_blocked is
    'Verifica si un perfil está bloqueado por demasidos intentos fallidos de login.';

grant execute on function umsuka.is_login_blocked to service_role;

-- ---------------------------------------------------------
-- 4. Función: registrar un intento de login
-- ---------------------------------------------------------
create or replace function umsuka.record_login_attempt(
    p_profile_id uuid,
    p_success    boolean,
    p_ip_address inet default null
)
returns void
language plpgsql
security definer
set search_path = umsuka, public
as $$
begin
    insert into umsuka.password_attempts (profile_id, success, ip_address)
    values (p_profile_id, p_success, p_ip_address);
end;
$$;

comment on function umsuka.record_login_attempt is
    'Registra un intento de login (éxito o fallo) para rate limiting.';

grant execute on function umsuka.record_login_attempt to service_role;

-- ---------------------------------------------------------
-- 5. Función: limpiar intentos antiguos (mantenimiento)
-- ---------------------------------------------------------
create or replace function umsuka.cleanup_old_password_attempts(
    p_retention_days int default 90
)
returns void
language plpgsql
security definer
set search_path = umsuka, public
as $$
begin
    delete from umsuka.password_attempts
    where created_at < now() - (p_retention_days || ' days')::interval;
end;
$$;

comment on function umsuka.cleanup_old_password_attempts is
    'Elimina intentos de login más antiguos que p_retention_days días.';

grant execute on function umsuka.cleanup_old_password_attempts to service_role;
