-- =========================================================
-- UMSUKA IMBALI APP — 0063: legal guardians (Sprint 30)
-- =========================================================
-- Representante legal para menores de edad. Un perfil puede
-- marcarse como menor (profiles.is_minor) y tener un representante
-- asociado (profiles.legal_guardian_id -> legal_guardians). El
-- representante puede ser un miembro interno (is_member + member_user_id)
-- o una persona externa con datos de contacto.
--
-- Design decisions:
--   1. FK profiles.legal_guardian_id -> legal_guardians (nullable SET NULL,
--      1:N guardian->menores) vs tabla puente N:M. Un menor tiene como
--      mucho un representante activo; un representante puede tener varios
--      menores a cargo — modelo directo sin tabla intermedia.
--   2. is_member + member_user_id coherentes por CHECK
--      chk_guardian_member_has_user: (not is_member AND member_user_id IS NULL)
--      OR (is_member AND member_user_id IS NOT NULL). Unifica interno/externo
--      en una sola tabla sin duplicar entidades.
--   3. Reutiliza umsuka.is_management() (0013) sin crear is_directiva
--      duplicado (ver ADR-24 D4 y ADR-29 D2).
--   4. is_minor default false + guardian nullable (flujo progresivo,
--      validación app-layer no CHECK DB): un menor sin representante aún
--      es válido en DB; la obligatoriedad se aplica en la capa de
--      aplicación/mutación.
--   5. RLS ENABLE + FORCE en umsuka.legal_guardians. SELECT y FOR ALL =
--      is_management(). Sin políticas para anon => fallback deny.
--      Invisibilidad real como transactions (0062).
--   6. RLS profiles intacta (ADR-14): el guardian ve a sus menores vía
--      queries app-layer (member_user_id join) evitando recursión RLS;
--      plantilla SECURITY DEFINER comentada para futuro si se quiere
--      exponer vía RLS.
--   7. Zod isomórfico con optionalTrimmedText->null en app layer.
--   8. Sin Supabase CLI local: tipos hand-edited + checklist manual.

-- ---------------------------------------------------------
-- 1. umsuka.legal_guardians
-- ---------------------------------------------------------
create table if not exists umsuka.legal_guardians (
    id uuid primary key default gen_random_uuid(),
    full_name text not null check (char_length(full_name) between 1 and 200),
    document_id text check (document_id is null or char_length(document_id) <= 50),
    email text check (email is null or char_length(email) <= 320),
    phone text check (phone is null or char_length(phone) <= 50),
    relationship text check (relationship is null or char_length(relationship) <= 100),
    is_member boolean not null default false,
    member_user_id uuid references umsuka.profiles(id) on delete set null,
    created_by uuid references umsuka.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint chk_guardian_member_has_user check (
        (not is_member and member_user_id is null)
        or
        (is_member and member_user_id is not null)
    )
);

comment on table umsuka.legal_guardians is
  'Representantes legales de menores de edad. Puede ser miembro interno (is_member=true + member_user_id) o persona externa con datos de contacto. Solo directiva puede gestionar.';

comment on column umsuka.legal_guardians.full_name is
  'Nombre completo del representante. Obligatorio, 1-200 caracteres.';
comment on column umsuka.legal_guardians.document_id is
  'Documento de identidad (DNI/NIE/pasaporte). Opcional, máx 50.';
comment on column umsuka.legal_guardians.email is
  'Email de contacto. Opcional, máx 320.';
comment on column umsuka.legal_guardians.phone is
  'Teléfono de contacto. Opcional, máx 50.';
comment on column umsuka.legal_guardians.relationship is
  'Parentesco o relación con el menor (madre, padre, tutor...). Opcional, máx 100.';
comment on column umsuka.legal_guardians.is_member is
  'true = el representante es miembro de la comparsa (member_user_id obligatorio); false = persona externa.';
comment on column umsuka.legal_guardians.member_user_id is
  'FK al perfil del miembro que actúa como representante. SET NULL si el perfil se borra. Solo no null cuando is_member=true (ver CHECK).';
comment on column umsuka.legal_guardians.created_by is
  'Perfil que creó el representante. SET NULL si el perfil se borra.';

-- ---------------------------------------------------------
-- 2. profiles columns for minor support
-- ---------------------------------------------------------
alter table umsuka.profiles add column if not exists is_minor boolean not null default false;
alter table umsuka.profiles add column if not exists legal_guardian_id uuid references umsuka.legal_guardians(id) on delete set null;

comment on column umsuka.profiles.is_minor is
  'true = perfil menor de edad. Requiere representante legal (validación app-layer). Default false.';
comment on column umsuka.profiles.legal_guardian_id is
  'FK al representante legal del menor. Nullable, SET NULL si el representante se borra. Solo relevante cuando is_minor=true.';

-- ---------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------
create index if not exists idx_legal_guardians_member_user_id
    on umsuka.legal_guardians (member_user_id);
create index if not exists idx_legal_guardians_created_by
    on umsuka.legal_guardians (created_by);
create index if not exists idx_legal_guardians_created_at
    on umsuka.legal_guardians (created_at desc);

create index if not exists idx_profiles_legal_guardian_id
    on umsuka.profiles (legal_guardian_id);
create index if not exists idx_profiles_is_minor
    on umsuka.profiles (is_minor) where is_minor = true;
create index if not exists idx_profiles_minor_guardian
    on umsuka.profiles (is_minor, legal_guardian_id);

-- ---------------------------------------------------------
-- 4. updated_at trigger
-- ---------------------------------------------------------
drop trigger if exists trg_legal_guardians_updated_at on umsuka.legal_guardians;

create trigger trg_legal_guardians_updated_at
  before update on umsuka.legal_guardians
  for each row
  execute function umsuka.update_updated_at_column();

-- ---------------------------------------------------------
-- 5. RLS — directiva exclusiva
-- ---------------------------------------------------------
alter table umsuka.legal_guardians enable row level security;
alter table umsuka.legal_guardians force row level security;

drop policy if exists "legal_guardians_select_management" on umsuka.legal_guardians;
create policy "legal_guardians_select_management"
  on umsuka.legal_guardians for select
  to authenticated
  using (umsuka.is_management());

drop policy if exists "legal_guardians_write_management" on umsuka.legal_guardians;
create policy "legal_guardians_write_management"
  on umsuka.legal_guardians for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

-- ---------------------------------------------------------
-- RLS profiles: intacta (ADR-14). El representante ve a sus
-- menores via queries app-layer (join por member_user_id) sin
-- necesidad de política adicional, evitando recursión RLS.
-- Plantilla futura SECURITY DEFINER comentada (no aplicar):
--
-- -- create policy "profiles_select_guardian_minor"
-- --   on umsuka.profiles for select
-- --   to authenticated
-- --   using (
-- --     is_minor = true
-- --     and legal_guardian_id in (
-- --       select id from umsuka.legal_guardians
-- --       where member_user_id = auth.uid()
-- --     )
-- --     or id = auth.uid()
-- --     or umsuka.is_management()
-- --   );
--
-- Mantener comentada hasta decidir exponer via RLS vs app-layer.
-- ---------------------------------------------------------

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (no Supabase local/CLI in this environment; SQL is
-- hand-reasoned — pattern of sprints 24/27/28/29). Verify before deploy:
--
-- [ ] umsuka.legal_guardians exists with columns, CHECKs and comments of
--       section 1 (full_name 1-200, document_id/email/phone/relationship
--       limits, is_member default false, chk_guardian_member_has_user,
--       FKs member_user_id/created_by SET NULL, created_at/updated_at now()).
-- [ ] umsuka.profiles has columns is_minor boolean not null default false
--       and legal_guardian_id uuid FK legal_guardians SET NULL with
--       comments of section 2.
-- [ ] Indexes of section 3 exist (member_user_id, created_by, created_at
--       desc, legal_guardian_id, is_minor partial where true,
--       (is_minor, legal_guardian_id)).
-- [ ] trg_legal_guardians_updated_at fires via
--       umsuka.update_updated_at_column() (0018) on UPDATE.
-- [ ] RLS: relrowsecurity = true AND relforcerowsecurity = true for
--       umsuka.legal_guardians.
-- [ ] pg_policies shows exactly 2 policies: legal_guardians_select_management
--       (select) and legal_guardians_write_management (all), both
--       `to authenticated` with `using (umsuka.is_management())`.
-- [ ] Non-management (member) SELECT returns 0 rows; INSERT/UPDATE/DELETE
--       violate RLS (new row violates row-level security policy).
-- [ ] Management (super_admin/admin/board_member/event_manager) can
--       SELECT/INSERT/UPDATE/DELETE on legal_guardians.
-- [ ] Assign/unassign via profiles.legal_guardian_id works for management;
--       FK SET NULL on guardian delete leaves profiles.legal_guardian_id = null.
-- [ ] is_minor=false with guardian null is valid (DB no enforce mandatory
--       guardian; app-layer validates).
-- [ ] chk_guardian_member_has_user rejects is_member=true without
--       member_user_id and is_member=false with member_user_id set.
-- [ ] Re-running migration is safe (if not exists / drop policy if exists
--       / drop trigger if exists / add column if not exists).
-- [ ] supabase db push applies migration; re-run is idempotent.
-- ---------------------------------------------------------
