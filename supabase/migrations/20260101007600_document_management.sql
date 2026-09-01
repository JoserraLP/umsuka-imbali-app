-- =========================================================
-- UMSUKA IMBALI APP — 0076: document management (Sprint 41)
-- =========================================================
-- Gestión documental con categorías y Supabase Storage.
-- Directiva/super_admin (is_management) sube/actualiza/elimina;
-- todos los miembros autenticados listan/filtran/descargan.
-- Bucket privado 'documents' (20 MB, 12 mimes). Versionado básico
-- por updated_at. Trazable por uploaded_by/created_by.
--
-- Design decisions:
--   1. Dos tablas: document_categories (jerárquica opcional via parent_id
--      SET NULL) y documents (file_path UNIQUE, file_size 1..20971520).
--   2. FK documents.category_id SET NULL (borrar categoría no borra doc).
--   3. MIME whitelist 12 tipos en CHECK + bucket + Zod (pdf, doc, docx,
--      xls, xlsx, ppt, pptx, png, jpeg, jpg, txt, csv).
--   4. RLS enable+force: SELECT authenticated true, ALL is_management()
--      (helper omsuka.is_management() de 0013).
--   5. Storage bucket 'documents' privado 20MB, políticas SELECT
--      authenticated true, INSERT/UPDATE/DELETE is_management().
--   6. Trigger updated_at reusa umsuka.update_updated_at_column() (0018).
--   7. Idempotencia: IF NOT EXISTS, drop policy/trigger if exists,
--      ON CONFLICT para bucket, duplicate_object guard para enum si aplica.
--

-- ---------------------------------------------------------
-- 1. umsuka.document_categories
-- ---------------------------------------------------------
create table if not exists umsuka.document_categories (
    id uuid primary key default gen_random_uuid(),
    name text not null unique check (char_length(name) between 1 and 100 and length(trim(name)) > 0),
    description text check (description is null or char_length(description) <= 1000),
    parent_id uuid references umsuka.document_categories(id) on delete set null,
    created_by uuid references umsuka.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table umsuka.document_categories is
  'Categorías de documentos (jerárquica opcional via parent_id SET NULL). Solo directiva (is_management) crea/edita/elimina; lectura para todos los autenticados.';
comment on column umsuka.document_categories.name is 'Nombre de la categoría 1-100 char UNIQUE, trim >0.';
comment on column umsuka.document_categories.description is 'Descripción opcional hasta 1000 char.';
comment on column umsuka.document_categories.parent_id is 'Categoría padre opcional para jerarquía. SET NULL al borrar padre.';
comment on column umsuka.document_categories.created_by is 'Perfil que creó la categoría. SET NULL si se borra.';
comment on column umsuka.document_categories.created_at is 'Instante de creación (default now()).';
comment on column umsuka.document_categories.updated_at is 'Instante de última actualización (trigger).';

create index if not exists idx_document_categories_parent_id on umsuka.document_categories (parent_id);
create index if not exists idx_document_categories_created_by on umsuka.document_categories (created_by);
create index if not exists idx_document_categories_name on umsuka.document_categories (name);

drop trigger if exists trg_document_categories_updated_at on umsuka.document_categories;
create trigger trg_document_categories_updated_at
  before update on umsuka.document_categories
  for each row
  execute function umsuka.update_updated_at_column();

-- ---------------------------------------------------------
-- 2. umsuka.documents
-- ---------------------------------------------------------
create table if not exists umsuka.documents (
    id uuid primary key default gen_random_uuid(),
    category_id uuid references umsuka.document_categories(id) on delete set null,
    name text not null check (char_length(name) between 1 and 200 and length(trim(name)) > 0),
    file_path text not null unique check (char_length(file_path) between 1 and 500 and length(trim(file_path)) > 0),
    file_size int not null check (file_size between 1 and 20971520),
    mime_type text not null check (mime_type in (
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'text/plain',
      'text/csv'
    )),
    uploaded_by uuid references umsuka.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table umsuka.documents is
  'Documentos con fichero en bucket documents (file_path UNIQUE). Solo directiva (is_management) sube/actualiza/elimina; lectura para todos los autenticados. file_size 1..20971520 (20 MB).';
comment on column umsuka.documents.category_id is 'Categoría opcional. SET NULL al borrar categoría.';
comment on column umsuka.documents.name is 'Nombre visible del documento 1-200 char, trim >0.';
comment on column umsuka.documents.file_path is 'Ruta en bucket documents (1-500 char UNIQUE, trim >0).';
comment on column umsuka.documents.file_size is 'Tamaño en bytes (1..20971520 = 20 MB).';
comment on column umsuka.documents.mime_type is 'MIME whitelist 12 tipos: pdf, doc, docx, xls, xlsx, ppt, pptx, png, jpeg, jpg, txt, csv.';
comment on column umsuka.documents.uploaded_by is 'Perfil que subió el documento. SET NULL si se borra.';
comment on column umsuka.documents.created_at is 'Instante de creación (default now()).';
comment on column umsuka.documents.updated_at is 'Instante de última actualización (trigger, versionado básico).';

create index if not exists idx_documents_category_id on umsuka.documents (category_id);
create index if not exists idx_documents_uploaded_by on umsuka.documents (uploaded_by);
create index if not exists idx_documents_mime_type on umsuka.documents (mime_type);
create index if not exists idx_documents_created_at on umsuka.documents (created_at desc);
create index if not exists idx_documents_name_trgm on umsuka.documents using gin (name gin_trgm_ops);

drop trigger if exists trg_documents_updated_at on umsuka.documents;
create trigger trg_documents_updated_at
  before update on umsuka.documents
  for each row
  execute function umsuka.update_updated_at_column();

-- ---------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------
alter table umsuka.document_categories enable row level security;
alter table umsuka.document_categories force row level security;

drop policy if exists "document_categories_select_authenticated" on umsuka.document_categories;
create policy "document_categories_select_authenticated"
  on umsuka.document_categories for select
  to authenticated
  using (true);

drop policy if exists "document_categories_write_management" on umsuka.document_categories;
create policy "document_categories_write_management"
  on umsuka.document_categories for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

grant select, insert, update, delete on table umsuka.document_categories to authenticated;
grant all on table umsuka.document_categories to service_role;

alter table umsuka.documents enable row level security;
alter table umsuka.documents force row level security;

drop policy if exists "documents_select_authenticated" on umsuka.documents;
create policy "documents_select_authenticated"
  on umsuka.documents for select
  to authenticated
  using (true);

drop policy if exists "documents_write_management" on umsuka.documents;
create policy "documents_write_management"
  on umsuka.documents for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

grant select, insert, update, delete on table umsuka.documents to authenticated;
grant all on table umsuka.documents to service_role;

-- ---------------------------------------------------------
-- 4. Storage bucket 'documents' (privado, 20 MB, 12 mimes)
-- ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  20971520,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'text/plain',
    'text/csv'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS policies on storage.objects (bucket_id = 'documents')
drop policy if exists "documents_storage_select_authenticated" on storage.objects;
create policy "documents_storage_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'documents');

drop policy if exists "documents_storage_insert_management" on storage.objects;
create policy "documents_storage_insert_management"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'documents' and umsuka.is_management());

drop policy if exists "documents_storage_update_management" on storage.objects;
create policy "documents_storage_update_management"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'documents' and umsuka.is_management())
  with check (bucket_id = 'documents' and umsuka.is_management());

drop policy if exists "documents_storage_delete_management" on storage.objects;
create policy "documents_storage_delete_management"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'documents' and umsuka.is_management());

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (10 puntos, idempotente)
-- [ ] Table umsuka.document_categories exists with name UNIQUE 1-100, description nullable, parent_id FK SET NULL, created_by FK, timestamps, comments.
-- [ ] Table umsuka.documents exists with name 1-200, file_path UNIQUE 1-500, file_size 1..20971520, mime 12 CHECK, category_id FK SET NULL, uploaded_by FK.
-- [ ] Indexes exist: document_categories(parent_id, created_by, name); documents(category_id, uploaded_by, mime_type, created_at desc).
-- [ ] Triggers trg_document_categories_updated_at y trg_documents_updated_at actualizan updated_at via update_updated_at_column().
-- [ ] RLS enabled+forced en ambas tablas; 2 policies cada una: SELECT authenticated true, ALL is_management().
-- [ ] Grants: select/insert/update/delete a authenticated, all a service_role en ambas tablas.
-- [ ] Non-management SELECT ve filas; INSERT/UPDATE/DELETE falla por RLS.
-- [ ] Bucket documents existe privado, file_size_limit=20971520, allowed_mime_types 12.
-- [ ] Storage policies existen: SELECT authenticated true, INSERT/UPDATE/DELETE solo is_management().
-- [ ] Re-run migración idempotente (IF NOT EXISTS, drop policy/trigger if exists, ON CONFLICT para bucket).
-- ---------------------------------------------------------
