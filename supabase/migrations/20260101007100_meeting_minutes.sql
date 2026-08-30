-- =========================================================
-- UMSUKA IMBALI APP — 0071: meeting minutes + reunion + summary (Sprint 34)
-- =========================================================
-- Actas de reuniones: cada acta es un fichero (PDF/DOC/DOCX, max 10 MB)
-- siempre asociado 1:1 a un evento tipo 'reunion'. Subida solo por
-- directiva/super_admin (is_management), lectura para todos los
-- miembros autenticados. Sin descarga en esta fase (solo metadata).
-- Además prepara base para Sprint 34 summary (no requiere migración
-- extra: reutiliza member_payments, dance_positions, musician_instruments).
--
-- Design decisions:
--   1. Nuevo valor 'reunion' en umsuka.event_type: distinto de 'meeting'
--      (meeting = reunión genérica existente; reunion = reunión formal con
--      acta). Se añade con DO duplicate_object + IF NOT EXISTS fallback
--      para compat PG sin IF NOT EXISTS.
--   2. Tabla umsuka.meeting_minutes separada (no columna en events):
--      permite metadata rica (file_path, file_name, size, mime, uploaded_by)
--      + UNIQUE(event_id) 1:1 + CHECK tamaño/mime + trigger updated_at +
--      trigger valida event_type='reunion' (no FK check posible).
--   3. Bucket 'meeting-minutes' privado en storage.buckets (insert
--      idempotente). Políticas storage.objects: INSERT/UPDATE/DELETE solo
--      is_management(), SELECT para authenticated (lectura metadata, no
--      descarga binaria aún).
--   4. RLS enable+force: SELECT authenticated true (todos ven que existe
--      acta), ALL is_management() (solo directiva escribe). Validación
--      event_type espejada en mutations con guard fail-closed.
--   5. Límites: file_size 1..10485760 (10 MB), mime_type IN
--      (application/pdf, application/msword,
--      application/vnd.openxmlformats-officedocument.wordprocessingml.document),
--      file_path/file_name 1..500 char, trim >0.
--   6. Idempotencia: IF NOT EXISTS / drop policy if exists / DO guards /
--      duplicate_object para enum.
--

-- ---------------------------------------------------------
-- 1. ENUM value 'reunion'
-- ---------------------------------------------------------
do $$ begin
  alter type umsuka.event_type add value if not exists 'reunion';
exception
  when duplicate_object then null;
  when others then
    begin
      alter type umsuka.event_type add value 'reunion';
    exception when duplicate_object then null;
    end;
end $$;

-- ---------------------------------------------------------
-- 2. umsuka.meeting_minutes
-- ---------------------------------------------------------
create table if not exists umsuka.meeting_minutes (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null unique references umsuka.events(id) on delete cascade,
    file_path text not null check (char_length(file_path) between 1 and 500 and length(trim(file_path)) > 0),
    file_name text not null check (char_length(file_name) between 1 and 255 and length(trim(file_name)) > 0),
    file_size int not null check (file_size between 1 and 10485760),
    mime_type text not null check (mime_type in (
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )),
    uploaded_by uuid references umsuka.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table umsuka.meeting_minutes is
  'Actas de reuniones: fichero 1:1 por evento tipo reunion (UNIQUE event_id CASCADE). Solo directiva (is_management) sube/reemplaza/elimina; lectura para todos los autenticados. Sin descarga en Sprint 34 (solo metadata).';
comment on column umsuka.meeting_minutes.event_id is
  'Evento de tipo reunion asociado. UNIQUE 1:1, CASCADE al borrar evento.';
comment on column umsuka.meeting_minutes.file_path is
  'Ruta en bucket meeting-minutes (1-500 char, trim >0).';
comment on column umsuka.meeting_minutes.file_name is
  'Nombre original del fichero (1-255 char).';
comment on column umsuka.meeting_minutes.file_size is
  'Tamaño en bytes (1..10485760 = 10 MB).';
comment on column umsuka.meeting_minutes.mime_type is
  'MIME: application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document.';
comment on column umsuka.meeting_minutes.uploaded_by is
  'Perfil que subió el acta. SET NULL si se borra.';
comment on column umsuka.meeting_minutes.created_at is 'Instante de creación (default now()).';
comment on column umsuka.meeting_minutes.updated_at is 'Instante de última actualización (trigger).';

create index if not exists idx_meeting_minutes_event_id
    on umsuka.meeting_minutes (event_id);
create index if not exists idx_meeting_minutes_uploaded_by
    on umsuka.meeting_minutes (uploaded_by);
create index if not exists idx_meeting_minutes_created_at
    on umsuka.meeting_minutes (created_at desc);

-- updated_at trigger (reuses umsuka.update_updated_at_column from 0018)
drop trigger if exists trg_meeting_minutes_updated_at on umsuka.meeting_minutes;
create trigger trg_meeting_minutes_updated_at
  before update on umsuka.meeting_minutes
  for each row
  execute function umsuka.update_updated_at_column();

-- ---------------------------------------------------------
-- 3. Validate event_id points to reunion event (trigger)
-- ---------------------------------------------------------
create or replace function umsuka.check_meeting_minutes_reunion()
returns trigger
language plpgsql
security definer
set search_path = umsuka, public
as $$
declare
  v_type text;
begin
  select event_type::text into v_type from umsuka.events where id = NEW.event_id;
  if v_type is null then
    raise exception 'Evento % no existe.', NEW.event_id;
  end if;
  if v_type <> 'reunion' then
    raise exception 'Solo eventos de tipo reunion pueden tener acta (evento % es tipo %).', NEW.event_id, v_type;
  end if;
  return NEW;
end;
$$;

comment on function umsuka.check_meeting_minutes_reunion() is
  'Valida que meeting_minutes.event_id apunte a un evento con event_type=reunion. Disparado BEFORE INSERT/UPDATE.';

drop trigger if exists trg_check_meeting_minutes_reunion on umsuka.meeting_minutes;
create trigger trg_check_meeting_minutes_reunion
  before insert or update of event_id on umsuka.meeting_minutes
  for each row
  execute function umsuka.check_meeting_minutes_reunion();

grant execute on function umsuka.check_meeting_minutes_reunion() to authenticated;

-- ---------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------
alter table umsuka.meeting_minutes enable row level security;
alter table umsuka.meeting_minutes force row level security;

drop policy if exists "meeting_minutes_select_authenticated" on umsuka.meeting_minutes;
create policy "meeting_minutes_select_authenticated"
  on umsuka.meeting_minutes for select
  to authenticated
  using (true);

drop policy if exists "meeting_minutes_write_management" on umsuka.meeting_minutes;
create policy "meeting_minutes_write_management"
  on umsuka.meeting_minutes for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

-- Grants for authenticated + service_role (bypass RLS via service_role privilege)
grant select, insert, update, delete on table umsuka.meeting_minutes to authenticated;
grant all on table umsuka.meeting_minutes to service_role;

-- ---------------------------------------------------------
-- 5. Storage bucket 'meeting-minutes' (privado)
-- ---------------------------------------------------------
-- Supabase Storage uses storage.buckets table. Insert idempotently.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meeting-minutes',
  'meeting-minutes',
  false,
  10485760,
  array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS policies on storage.objects (bucket_id = 'meeting-minutes')
-- Select: authenticated can read metadata (no download presigned URL yet, but object visible)
drop policy if exists "meeting_minutes_storage_select_authenticated" on storage.objects;
create policy "meeting_minutes_storage_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'meeting-minutes');

drop policy if exists "meeting_minutes_storage_insert_management" on storage.objects;
create policy "meeting_minutes_storage_insert_management"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'meeting-minutes' and umsuka.is_management());

drop policy if exists "meeting_minutes_storage_update_management" on storage.objects;
create policy "meeting_minutes_storage_update_management"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'meeting-minutes' and umsuka.is_management())
  with check (bucket_id = 'meeting-minutes' and umsuka.is_management());

drop policy if exists "meeting_minutes_storage_delete_management" on storage.objects;
create policy "meeting_minutes_storage_delete_management"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'meeting-minutes' and umsuka.is_management());

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (hand-reasoned, no local Supabase)
-- [ ] Type umsuka.event_type now includes 'reunion' (SELECT unnest(enum_range(NULL::umsuka.event_type))).
-- [ ] Table umsuka.meeting_minutes exists with columns, CHECKs, UNIQUE(event_id), FK CASCADE, comments.
-- [ ] Indexes exist (event_id, uploaded_by, created_at desc).
-- [ ] Trigger trg_meeting_minutes_updated_at updates updated_at on UPDATE.
-- [ ] Function umsuka.check_meeting_minutes_reunion rejects INSERT where event.event_type <> 'reunion'.
-- [ ] RLS enabled+forced; 2 policies: select_authenticated (USING true) and write_management (ALL is_management()).
-- [ ] Non-management SELECT sees rows; INSERT/UPDATE/DELETE violates RLS.
-- [ ] Management can SELECT/INSERT/UPDATE/DELETE.
-- [ ] Insert with file_size >10485760 or mime not in list fails CHECK.
-- [ ] Duplicate event_id fails UNIQUE violation.
-- [ ] Insert with event_id pointing to non-reunion fails trigger exception.
-- [ ] Bucket meeting-minutes exists, public=false, file_size_limit=10485760, allowed_mime_types 3 types.
-- [ ] storage.objects policies exist (select authenticated, insert/update/delete management).
-- [ ] Re-run migration idempotent (IF NOT EXISTS, drop policy if exists, ON CONFLICT, DO duplicate_object).
-- ---------------------------------------------------------
