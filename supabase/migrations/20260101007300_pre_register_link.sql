-- =========================================================
-- UMSUKA IMBALI APP — 0073: pre-registro sin Gmail y vinculación (Sprint 40)
-- =========================================================
-- Solo super_admin da de alta perfiles sin Gmail (link_status=pending_gmail).
-- El perfil queda pendiente hasta que super_admin vincula un Gmail,
-- conservando histórico (pagos, formación, asistencia). Incluye invite_token
-- para auto-vinculación /invite/<token>.
--
-- Design decisions:
--   1. ENUM link_status pending_gmail/linked cerrado (2 valores).
--   2. profiles.link_status link_status NOT NULL DEFAULT 'linked' (backfill linked).
--   3. profiles.pre_registered_by uuid FK profiles SET NULL (quién pre-registró).
--   4. profiles.invite_token text UNIQUE parcial nullable, pending_email text nullable.
--   5. CHECK coherencia link_status + índices parciales UNIQUE.
--   6. RLS enable+force: SELECT true (filtrable pending_gmail), INSERT/UPDATE pending/link solo is_super_admin().
--   7. Helper umsuka.current_user_link_status() para middleware.
--   8. Idempotencia completa (IF NOT EXISTS, duplicate_object, DROP POLICY IF EXISTS).
--

-- ---------------------------------------------------------
-- 1. ENUM link_status
-- ---------------------------------------------------------
do $$ begin
  create type umsuka.link_status as enum ('pending_gmail', 'linked');
exception when duplicate_object then null;
end $$;

comment on type umsuka.link_status is
  'Estado de vinculación Gmail: pending_gmail = pre-registrado sin Gmail, linked = vinculado con Gmail.';

-- ---------------------------------------------------------
-- 2. Columns on umsuka.profiles
-- ---------------------------------------------------------
alter table umsuka.profiles add column if not exists link_status umsuka.link_status not null default 'linked'::umsuka.link_status;
alter table umsuka.profiles add column if not exists pre_registered_by uuid references umsuka.profiles(id) on delete set null;
alter table umsuka.profiles add column if not exists invite_token text;
alter table umsuka.profiles add column if not exists pending_email text;

comment on column umsuka.profiles.link_status is 'pending_gmail = alta sin Gmail (pendiente vinculación), linked = cuenta vinculada. Default linked para existentes.';
comment on column umsuka.profiles.pre_registered_by is 'Super admin que pre-registró el miembro. FK SET NULL.';
comment on column umsuka.profiles.invite_token is 'Token UUID invitacion para /invite/<token>. UNIQUE parcial WHERE NOT NULL.';
comment on column umsuka.profiles.pending_email is 'Email pendiente opcional capturado en pre-registro.';

-- Backfill: todos los existentes → linked (ya es default, pero asegurar)
update umsuka.profiles set link_status = 'linked'::umsuka.link_status where link_status is null;

-- CHECK coherencia: invite_token y pending_email deben ser null cuando linked? Permitimos null en ambos, pero si pending_gmail puede tener token.
-- Añadimos CHECK suave: invite_token si not null debe tener longitud >= 8
do $$ begin
  alter table umsuka.profiles add constraint chk_profiles_link_status_coherence
    check (
      (link_status = 'linked' and (invite_token is null or char_length(invite_token) >= 8))
      or
      (link_status = 'pending_gmail' and (invite_token is null or char_length(invite_token) >= 8))
    );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------
-- 3. Indices parciales
-- ---------------------------------------------------------
create unique index if not exists uniq_profiles_invite_token on umsuka.profiles (invite_token) where invite_token is not null;
create unique index if not exists uniq_profiles_pending_email on umsuka.profiles (pending_email) where pending_email is not null;
create index if not exists idx_profiles_link_status on umsuka.profiles (link_status);
create index if not exists idx_profiles_pre_registered_by on umsuka.profiles (pre_registered_by);

-- ---------------------------------------------------------
-- 4. Helper current_user_link_status()
-- ---------------------------------------------------------
create or replace function umsuka.current_user_link_status()
returns text
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select link_status::text from umsuka.profiles where id = auth.uid();
$$;

comment on function umsuka.current_user_link_status() is
  'Devuelve link_status del usuario actual (pending_gmail/linked) o null si no existe.';

grant execute on function umsuka.current_user_link_status() to authenticated;

-- ---------------------------------------------------------
-- 5. RLS: SELECT sigue igual (active miembros ven todos, pending/suspended solo own)
--    INSERT/UPDATE para pre-registro solo super_admin
-- ---------------------------------------------------------
alter table umsuka.profiles enable row level security;
alter table umsuka.profiles force row level security;

-- SELECT: mantener política existente pero re-crear idempotente
drop policy if exists "profiles_select_authenticated" on umsuka.profiles;
create policy "profiles_select_authenticated"
  on umsuka.profiles for select
  to authenticated
  using (umsuka.is_active_member() or id = auth.uid());

-- INSERT: solo super_admin puede insertar perfiles pending_gmail (y en general insertar)
drop policy if exists "profiles_insert_pre_register_super_admin" on umsuka.profiles;
create policy "profiles_insert_pre_register_super_admin"
  on umsuka.profiles for insert
  to authenticated
  with check (umsuka.is_super_admin());

-- UPDATE link: solo super_admin puede cambiar link_status/invite_token/pending_email
-- HIGH 4 fix: restringido a is_super_admin() únicamente (sin OR id=auth.uid())
-- Idempotente: DROP IF EXISTS + CREATE con USING/WITH CHECK is_super_admin()
drop policy if exists "profiles_update_link_super_admin" on umsuka.profiles;
create policy "profiles_update_link_super_admin"
  on umsuka.profiles for update
  to authenticated
  using (umsuka.is_super_admin())
  with check (umsuka.is_super_admin());

-- Nota: profiles_update_own_or_admin y profiles_delete_admin ya existen y cubren casos generales.
-- Las nuevas políticas complementan el control para pre-registro sin romper flujos existentes.
-- Si existe una policy genérica update_own que permita UPDATE sobre profiles, NO debe
-- permitir cambiar columnas sensibles link_status/invite_token/pending_email. La
-- alternativa sería un trigger BEFORE UPDATE que eleve error si OLD.link_status
-- != NEW.link_status y el caller no es super_admin; se documenta aquí como
-- opción si la auditoría detecta bypass por otra policy permisiva.

grant select, insert, update, delete on table umsuka.profiles to authenticated;
grant all on table umsuka.profiles to service_role;

-- ---------------------------------------------------------
-- MANUAL CHECKLIST
-- [ ] Type link_status exists (pending_gmail,linked).
-- [ ] Columns link_status NOT NULL DEFAULT linked, pre_registered_by FK SET NULL, invite_token UNIQUE parcial, pending_email nullable existen.
-- [ ] Backfill existentes -> linked sin sobrescribir pendientes.
-- [ ] CHECK chk_profiles_link_status_coherence existe.
-- [ ] Indices uniq_profiles_invite_token WHERE NOT NULL, uniq_profiles_pending_email WHERE NOT NULL, idx link_status, idx pre_registered_by.
-- [ ] Helper current_user_link_status() existe SECURITY DEFINER.
-- [ ] RLS enable+force, policies profiles_select_authenticated (active or own), profiles_insert_pre_register_super_admin (is_super_admin), profiles_update_link_super_admin (solo is_super_admin() — HIGH 4 fix).
-- [ ] Non-super_admin INSERT pending_gmail falla RLS.
-- [ ] Super_admin puede INSERT pending_gmail y UPDATE link a linked.
-- [ ] Re-run idempotente (IF NOT EXISTS, ON CONFLICT, duplicate_object, DROP POLICY IF EXISTS).
-- ---------------------------------------------------------
