-- =========================================================
-- UMSUKA IMBALI APP — 0072: carnival year reset + snapshots (Sprint 38)
-- =========================================================
-- Nuevo año de carnaval: directiva/super_admin archiva el año anterior
-- (status=archived, end_date=now()) y guarda TODO el año como copia
-- histórica completa en carnival_year_snapshots + Storage
-- carnival-backups/<year>.json. Los contadores del nuevo año empiezan
-- a 0 sin borrar histórico ni perfiles. Rollback si falla snapshot.
--
-- Design decisions:
--   1. ENUM carnival_year_status active/archived cerrado (2 valores).
--   2. carnival_years: year INT UNIQUE 2000-2100, label 1-200, start/end date,
--      status default active, created_by FK, created_at. Índice year+status.
--   3. carnival_year_snapshots: id uuid pk, carnival_year_id FK CASCADE,
--      snapshot_type text 1-100 (members, events, payments, attendance...),
--      data jsonb (snapshot completo), created_at. Índice por year_id.
--   4. Columnas carnival_year_id FK nullable en tablas anuales
--      (events, member_payments, dance_formations) para filtrar por año
--      activo sin romper datos legacy (NULL = año legacy/activo inicial).
--      Backfill: tras crear año inicial 2026, asignar ese id a filas
--      existentes donde carnival_year_id IS NULL.
--   5. Bucket carnival-backups privado, file_size_limit 50MB json,
--      allowed_mime application/json. Políticas: SELECT/INSERT/UPDATE/DELETE
--      solo is_management() (histórico solo directiva).
--   6. RLS enable+force: carnival_years SELECT true (todos ven año activo),
--      ALL is_management(); snapshots SELECT/ALL is_management() (solo
--      directiva ve histórico). Member no ve snapshots.
--   7. Idempotencia completa (IF NOT EXISTS, duplicate_object, drop if exists).
--

-- ---------------------------------------------------------
-- 1. ENUM carnival_year_status
-- ---------------------------------------------------------
do $$ begin
  create type umsuka.carnival_year_status as enum ('active', 'archived');
exception when duplicate_object then null;
end $$;

comment on type umsuka.carnival_year_status is
  'Estado del año de carnaval: active = año en curso, archived = año cerrado con snapshot.';

-- ---------------------------------------------------------
-- 2. umsuka.carnival_years
-- ---------------------------------------------------------
create table if not exists umsuka.carnival_years (
    id uuid primary key default gen_random_uuid(),
    year int not null unique check (year between 2000 and 2100),
    label text not null check (char_length(label) between 1 and 200 and length(trim(label)) > 0),
    start_date date not null,
    end_date date check (end_date is null or end_date >= start_date),
    status umsuka.carnival_year_status not null default 'active'::umsuka.carnival_year_status,
    created_by uuid references umsuka.profiles(id) on delete set null,
    created_at timestamptz not null default now()
);

comment on table umsuka.carnival_years is
  'Años de carnaval: un año activo a la vez, resto archived. Snapshot histórico en carnival_year_snapshots + Storage carnival-backups.';
comment on column umsuka.carnival_years.year is 'Año natural 2000-2100, UNIQUE.';
comment on column umsuka.carnival_years.label is 'Etiqueta 1-200 ej. Carnaval 2026.';
comment on column umsuka.carnival_years.start_date is 'Fecha inicio del año de carnaval.';
comment on column umsuka.carnival_years.end_date is 'Fecha cierre (NULL mientras active, set al archivar). CHECK end >= start.';
comment on column umsuka.carnival_years.status is 'active solo uno a la vez (validado en app), archived al cerrar.';
comment on column umsuka.carnival_years.created_by is 'Directiva que creó/archivó el año. SET NULL si se borra.';
comment on column umsuka.carnival_years.created_at is 'Instante creación (default now()).';

create index if not exists idx_carnival_years_year on umsuka.carnival_years (year);
create index if not exists idx_carnival_years_status on umsuka.carnival_years (status);
create index if not exists idx_carnival_years_created_at on umsuka.carnival_years (created_at desc);
create unique index if not exists uniq_carnival_years_active on umsuka.carnival_years (status) where status = 'active';

-- ---------------------------------------------------------
-- 3. umsuka.carnival_year_snapshots
-- ---------------------------------------------------------
create table if not exists umsuka.carnival_year_snapshots (
    id uuid primary key default gen_random_uuid(),
    carnival_year_id uuid not null references umsuka.carnival_years(id) on delete cascade,
    snapshot_type text not null check (char_length(snapshot_type) between 1 and 100 and length(trim(snapshot_type)) > 0),
    data jsonb not null,
    created_at timestamptz not null default now()
);

comment on table umsuka.carnival_year_snapshots is
  'Snapshots históricos por año: una fila por sección (members, events, payments, attendance, formations, instruments, transactions, votings, questions, stats...). data jsonb contiene copia completa.';
comment on column umsuka.carnival_year_snapshots.carnival_year_id is 'Año archivado al que pertenece el snapshot. CASCADE.';
comment on column umsuka.carnival_year_snapshots.snapshot_type is 'Sección ej. members, events, member_payments, rehearsal_attendance, dance_formations, instruments, transactions, votings, questions, stats.';
comment on column umsuka.carnival_year_snapshots.data is 'JSONB con copia completa de la sección.';
comment on column umsuka.carnival_year_snapshots.created_at is 'Instante creación snapshot.';

create index if not exists idx_carnival_snapshots_year_id on umsuka.carnival_year_snapshots (carnival_year_id);
create index if not exists idx_carnival_snapshots_type on umsuka.carnival_year_snapshots (snapshot_type);
create index if not exists idx_carnival_snapshots_created_at on umsuka.carnival_year_snapshots (created_at desc);
create unique index if not exists uniq_carnival_snapshots_year_type on umsuka.carnival_year_snapshots (carnival_year_id, snapshot_type);

-- ---------------------------------------------------------
-- 4. Add carnival_year_id to annual tables (nullable)
-- ---------------------------------------------------------
alter table umsuka.events add column if not exists carnival_year_id uuid references umsuka.carnival_years(id) on delete set null;
alter table umsuka.member_payments add column if not exists carnival_year_id uuid references umsuka.carnival_years(id) on delete set null;
alter table umsuka.dance_formations add column if not exists carnival_year_id uuid references umsuka.carnival_years(id) on delete set null;
alter table umsuka.transactions add column if not exists carnival_year_id uuid references umsuka.carnival_years(id) on delete set null;

comment on column umsuka.events.carnival_year_id is 'Año de carnaval al que pertenece el evento. NULL = legacy/activo inicial.';
comment on column umsuka.member_payments.carnival_year_id is 'Año al que pertenece el pago. NULL = legacy.';
comment on column umsuka.dance_formations.carnival_year_id is 'Año al que pertenece la formación.';
comment on column umsuka.transactions.carnival_year_id is 'Año al que pertenece la transacción de comparsa.';

create index if not exists idx_events_carnival_year_id on umsuka.events (carnival_year_id);
create index if not exists idx_member_payments_carnival_year_id on umsuka.member_payments (carnival_year_id);
create index if not exists idx_dance_formations_carnival_year_id on umsuka.dance_formations (carnival_year_id);
create index if not exists idx_transactions_carnival_year_id on umsuka.transactions (carnival_year_id);

-- ---------------------------------------------------------
-- 5. Backfill: create initial year 2026 if no active year exists
-- ---------------------------------------------------------
do $$
declare
  v_year_id uuid;
begin
  if not exists (select 1 from umsuka.carnival_years where status = 'active'::umsuka.carnival_year_status) then
    insert into umsuka.carnival_years (year, label, start_date, status)
    values (2026, 'Carnaval 2026', '2026-01-01'::date, 'active'::umsuka.carnival_year_status)
    on conflict (year) do nothing
    returning id into v_year_id;

    -- If insert did not return (conflict), fetch existing 2026
    if v_year_id is null then
      select id into v_year_id from umsuka.carnival_years where year = 2026 limit 1;
    end if;

    if v_year_id is not null then
      -- Assign existing rows without year to this initial year
      update umsuka.events set carnival_year_id = v_year_id where carnival_year_id is null;
      update umsuka.member_payments set carnival_year_id = v_year_id where carnival_year_id is null;
      update umsuka.dance_formations set carnival_year_id = v_year_id where carnival_year_id is null;
      update umsuka.transactions set carnival_year_id = v_year_id where carnival_year_id is null;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------
alter table umsuka.carnival_years enable row level security;
alter table umsuka.carnival_years force row level security;

drop policy if exists "carnival_years_select_authenticated" on umsuka.carnival_years;
create policy "carnival_years_select_authenticated"
  on umsuka.carnival_years for select
  to authenticated
  using (true);

drop policy if exists "carnival_years_write_management" on umsuka.carnival_years;
create policy "carnival_years_write_management"
  on umsuka.carnival_years for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

grant select, insert, update, delete on table umsuka.carnival_years to authenticated;
grant all on table umsuka.carnival_years to service_role;

alter table umsuka.carnival_year_snapshots enable row level security;
alter table umsuka.carnival_year_snapshots force row level security;

drop policy if exists "carnival_snapshots_select_management" on umsuka.carnival_year_snapshots;
create policy "carnival_snapshots_select_management"
  on umsuka.carnival_year_snapshots for select
  to authenticated
  using (umsuka.is_management());

drop policy if exists "carnival_snapshots_write_management" on umsuka.carnival_year_snapshots;
create policy "carnival_snapshots_write_management"
  on umsuka.carnival_year_snapshots for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

grant select, insert, update, delete on table umsuka.carnival_year_snapshots to authenticated;
grant all on table umsuka.carnival_year_snapshots to service_role;

-- ---------------------------------------------------------
-- 7. Storage bucket carnival-backups (privado)
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'carnival-backups',
  'carnival-backups',
  false,
  52428800,
  array['application/json']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "carnival_backups_select_management" on storage.objects;
create policy "carnival_backups_select_management"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'carnival-backups' and umsuka.is_management());

drop policy if exists "carnival_backups_insert_management" on storage.objects;
create policy "carnival_backups_insert_management"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'carnival-backups' and umsuka.is_management());

drop policy if exists "carnival_backups_update_management" on storage.objects;
create policy "carnival_backups_update_management"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'carnival-backups' and umsuka.is_management())
  with check (bucket_id = 'carnival-backups' and umsuka.is_management());

drop policy if exists "carnival_backups_delete_management" on storage.objects;
create policy "carnival_backups_delete_management"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'carnival-backups' and umsuka.is_management());

-- ---------------------------------------------------------
-- MANUAL CHECKLIST
-- [ ] Type carnival_year_status exists (active,archived).
-- [ ] Table carnival_years exists with year UNIQUE 2000-2100, label 1-200, status default active, CHECK end>=start, partial unique active.
-- [ ] Table carnival_year_snapshots exists with UNIQUE(year_id,snapshot_type), FK CASCADE.
-- [ ] Columns carnival_year_id exist on events/member_payments/dance_formations/transactions (nullable FK).
-- [ ] Initial year 2026 inserted if no active, existing rows backfilled.
-- [ ] RLS enabled+forced, 2 policies each table (years SELECT true/ALL management, snapshots SELECT/ALL management).
-- [ ] Non-management SELECT years sees active, snapshots 0 rows, INSERT fails RLS.
-- [ ] Management can SELECT/INSERT/UPDATE years and snapshots.
-- [ ] Bucket carnival-backups exists private 50MB json, 4 storage policies management only.
-- [ ] Re-run idempotent (IF NOT EXISTS, ON CONFLICT, duplicate_object, drop if exists).
-- ---------------------------------------------------------
