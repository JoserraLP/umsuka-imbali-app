# ADR-041: Sprint 41 — Gestión Documental con Supabase Storage

**Status:** Accepted (Implementado) · **Date:** 2026-09-01 · **Sprint:** 41 ·
**Branch:** `feature/sprint-41-document-management`

---

## Context

La comparsa necesita un repositorio central de documentos (estatutos, actas complementarias, partituras, plantillas, justificantes) organizado por categorías y accesible desde `/documents`. Hasta Sprint 40 los ficheros estaban dispersos: solo existía el bucket `meeting-minutes` (3 mimes, 10 MB) ligado 1:1 a eventos `reunion`. Se requiere un bucket único `documents` privado, categorías jerárquicas opcionales, permisos por rol (directiva gestiona, todos consultan), validación de tipo/tamaño (máx 20 MB, 12 mimes comunes: pdf, doc, docx, xls, xlsx, ppt, pptx, png, jpg/jpeg, txt, csv) y UI completa con subida drag & drop, filtros, visor y descarga. Debe respetar RLS fail-closed, versionado básico por `updated_at`, auditoría por `created_by`/`uploaded_by` y trazabilidad en Storage + BD.

Requisitos (`tasks/sprint-41-document-management.json`):

- Documentos organizados por categorías (jerárquicas opcionales) y listados con nombre, tamaño, mime_type, categoría y fecha de subida.
- Solo directiva (`is_management()`) y `super_admin` pueden subir, reemplazar y eliminar; todos los miembros autenticados pueden listar, filtrar y descargar.
- Archivos en Supabase Storage bucket `documents` con políticas RLS por rol y validación tipo/tamaño (máx 20 MB, 12 mimes).
- Página `/documents` con vista de categorías, tabla/listado filtrable y buscable, drag & drop o selector con indicador de progreso, y detalle/descarga.
- Cada subida/actualización registra `created_by`/`uploaded_by` y `updated_at`; eliminación física en Storage + BD y trazable.
- RLS y server actions validan rol fail-closed; miembro base no puede subir ni eliminar.

Dependencias: Sprint 21 (Admin Panel — helper `is_management`), Sprint 2 (Roles directiva/super_admin), Sprint 16 (Storage base), Sprint 34 (`meeting-minutes` como patrón Storage).

Última migración: `20260101007300_pre_register_link.sql`; este sprint añade **0076**.

---

## Decisión

### D1 — Tablas `umsuka.document_categories` y `umsuka.documents` (FK SET NULL, CHECKs estrictos)

```sql
create table if not exists umsuka.document_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 100 and trim >0),
  description text check (null or <=1000),
  parent_id uuid references document_categories(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists umsuka.documents (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references document_categories(id) on delete set null,
  name text not null check (1-200 trim >0),
  file_path text not null unique check (1-500 trim >0),
  file_size int not null check (1..20971520),
  mime_type text not null check (in 12 whitelist),
  uploaded_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

- `parent_id SET NULL` permite jerarquía opcional sin borrar hijas al borrar padre; `category_id SET NULL` evita borrar documentos al borrar categoría.
- `file_path UNIQUE 1-500` evita colisión en bucket; `file_size 1..20971520` (20 MB) espeja límite de bucket + CHECK DB.
- `mime_type` CHECK cerrado con 12 valores: `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.ms-powerpoint`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`, `image/png`, `image/jpeg`, `image/jpg`, `text/plain`, `text/csv` (incluye `image/jpg` legacy para compatibilidad con uploads antiguos aunque MIME canónico es `image/jpeg`).
- Comentarios `pg_description` en tablas/columnas para `DATABASE.md`.
- Índices: `document_categories(parent_id, created_by, name)`, `documents(category_id, uploaded_by, mime_type, created_at desc)` + GIN `gin_trgm_ops` en `documents.name` para `ilike '%search%'` eficiente.
- Trigger `before update` reutiliza `umsuka.update_updated_at_column()` (migración 0018) — versionado básico por `updated_at` (no histórico completo; sobrescribe).

### D2 — RLS `ENABLE + FORCE` fail-closed con helper `umsuka.is_management()`

```sql
alter table document_categories enable row level security; force row level security;
create policy document_categories_select_authenticated for select to authenticated using (true);
create policy document_categories_write_management for all to authenticated
  using (umsuka.is_management()) with check (umsuka.is_management());

alter table documents enable row level security; force row level security;
create policy documents_select_authenticated for select to authenticated using (true);
create policy documents_write_management for all to authenticated
  using (umsuka.is_management()) with check (umsuka.is_management());

grant select,insert,update,delete on document_categories, documents to authenticated;
grant all on document_categories, documents to service_role;
```

- `SELECT authenticated true` — todos los autenticados listan/filtran (visibilidad uniforme, sin RLS por categoría en MVP).
- `ALL is_management()` — solo directiva/super_admin puede INSERT/UPDATE/DELETE; `is_management()` importado de `20260101001300` (Sprint 21) que chequea `role` o `is_workgroup_lead`. Fail-closed: `non-management INSERT` → 42501.
- `FORCE RLS` bloquea también `table owner` y fuerza paso por policies; `service_role` bypass para `createAdminClient` en mutations/download.
- Alternativa "RLS por categoría" descartada: complejidad sin requisito; visibilidad uniforme es suficiente (ver Alternativas).

### D3 — Storage bucket `documents` privado (20 MB, 12 mimes) + 4 políticas Storage

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents','documents', false, 20971520, array[12 mimes])
on conflict (id) do update set public=file_size_limit=allowed_mime_types=excluded.*;

create policy documents_storage_select_authenticated on storage.objects for select to authenticated
  using (bucket_id='documents');
create policy documents_storage_insert_management on storage.objects for insert to authenticated
  with check (bucket_id='documents' and is_management());
create policy documents_storage_update_management on storage.objects for update to authenticated
  using (bucket_id='documents' and is_management()) with check (...);
create policy documents_storage_delete_management on storage.objects for delete to authenticated
  using (bucket_id='documents' and is_management());
```

- `public=false` (privado), `file_size_limit=20971520`, `allowed_mime_types` idéntico al CHECK DB + Zod.
- `SELECT` para `authenticated` permite `createSignedUrl`/`download`; `INSERT/UPDATE/DELETE` solo `is_management()`. No hay policy para `anon` → 0 rows.
- `ON CONFLICT do update` hace idempotente el bucket (update si ya existe con límites distintos).
- Alternativa "reutilizar bucket `meeting-minutes`" descartada: límites distintos (10 MB vs 20 MB, 3 vs 12 mimes) y semántica distinta (acta 1:1 vs repo genérico).

### D4 — Capa `lib/documents/schema.ts` Zod (mensajes es-ES, fallback por extensión)

```ts
export const ALLOWED_MIME_TYPES = [12 mimes] as const; // 20 MB
export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const createCategorySchema = z.object({
  name: z.string().trim().min(1,"El nombre de la categoría es obligatorio.").max(100,"...100..."),
  description: z.string().trim().max(1000).nullable().optional().transform(v=> v===""?null:v),
  parentId: z.string().uuid("La categoría padre debe ser un UUID válido.").nullable().optional(),
});
export const createDocumentSchema = z.object({
  name: z.string().trim().min(1,"El nombre del documento es obligatorio.").max(200,"...200..."),
  categoryId: z.string().uuid("La categoría debe ser un UUID válido.").nullable().optional(),
  filePath: z.string().trim().min(1,"La ruta del fichero es obligatoria.").max(500,"...500..."),
  fileSize: z.number().int().min(1,"El fichero no puede estar vacío.").max(MAX_FILE_SIZE,"El fichero no puede superar 20 MB."),
  mimeType: z.enum(ALLOWED_MIME_TYPES,{errorMap:()=>({message:"Tipo de fichero no permitido."})}),
});
export function validateDocumentFile(file:{name,size,type}) // fallback ext→mime (jpg→jpeg, etc.)
export function inferMimeFromExtension(fileName, fallback) // idem para mutations
export function formatFileSize(bytes) // B/KB/MB
```

- `validateDocumentFile` hace fallback por extensión (`pdf→application/pdf`, `jpg/jpeg→image/jpeg`, etc.) porque `file.type` puede venir vacío o como `image/jpg` según navegador/OS; si no mapea → `"Tipo de fichero no permitido."`; luego valida `size 1..20MB`.
- `inferMimeFromExtension` usado en `mutations.createDocument` para normalizar `jpg→jpeg` antes de `ALLOWED_MIME_TYPES.includes`.
- Mensajes es-ES consistentes con `meetings/schema.ts` y `pre-register-schema.ts`.

### D5 — Capa `lib/documents/queries.ts` server-only (filtros DB, join categoría)

```ts
export async function getCategories(): Promise<DocumentCategoryRow[]> // order name asc
export async function getDocuments({search, categoryId, mimeType}?) // ilike name, eq category/mime, order created_at desc, select document_categories(name)
export async function getDocumentById(id) // maybeSingle + join
```

- `server-only` garantiza uso solo en Server Components / Route Handlers.
- `getDocuments` construye query dinámicamente: `ilike("name", %search%)` usa índice GIN trigram; `eq category_id/mime_type` usa índices btree; `order created_at desc` usa índice `created_at desc`.
- `mapCategoryRow`/`mapDocumentRow` adaptan snake→camel + `categoryName` desde `document_categories` join (nullable → null si sin categoría).
- Sin paginación en MVP (lista completa filtrada en DB); para >500 docs se propone paginación con `range`.

### D6 — Capa `lib/documents/mutations.ts` con guard `isManagementRole` fail-closed

```ts
function requireManagementGuard(profile) { if (!profile) "No autenticado."; if (!isManagementRole) "Solo la directiva puede gestionar documentos." }
export async function createCategory({name,description,parentId})
export async function updateCategory({id,name,description,parentId})
export async function deleteCategory(id)
export async function createDocument({name,categoryId,file:File}) // validateDocumentFile + inferMime + upload via admin + insert
export async function updateDocument({id,name,categoryId}) // solo metadata
export async function deleteDocument(id) // select file_path → delete row → admin.storage.remove(file_path) best-effort
```

- Guard replicado de `meetings/mutations.ts` y `pre-register.ts`: chequea `getCurrentProfile()` + `isManagementRole(profile.role)`; fail-closed antes de Zod/DB.
- `createDocument`: valida `file.size>0`, `validateDocumentFile`, `inferMimeFromExtension`, valida metadata con `createDocumentSchema` (placeholder filePath), genera `filePath = ${profile.id}/${Date.now()}-${rand6}.${ext}` (6 chars base36, `upsert:false` para evitar overwrite colisión), `admin.storage.from("documents").upload(filePath,file,{contentType:mimeType, upsert:false})`, luego `supabase.from("documents").insert(...)`; si insert falla (23505 file_path duplicate o RLS) → `admin.remove([filePath])` cleanup huérfano.
- `deleteDocument`: fetch `file_path` con `maybeSingle` antes de `delete`; tras `delete` exitoso → `admin.storage.remove([file_path])` best-effort (no bloquea si Storage falla).
- Errores mapeados: `23505` en `createCategory` → `"Ya existe una categoría con ese nombre."`; en `createDocument` → `"Ya existe un documento con esa ruta."` (improbable por rand, pero cubierto).

### D7 — Server Actions thin `src/lib/documents/actions.ts` con `revalidatePath`

```ts
"use server";
export async function createDocumentCategoryAction(formData) { createCategory → revalidatePath("/documents") }
export async function deleteDocumentCategoryAction(id) { deleteCategory → revalidatePath("/documents") }
export async function createDocumentAction(formData) { createDocument({name||file.name, categoryId, file}) → revalidatePath }
export async function updateDocumentAction(formData) { updateDocument → revalidatePath }
export async function deleteDocumentAction(id) { deleteDocument → revalidatePath }
```

- Patrón idéntico a `meetings/actions.ts` y `pre-register-actions.ts`: thin wrappers, guards dentro de `mutations.ts`, solo revalidan `/documents`. No exponen `service_role` al cliente (actions son server).

### D8 — UI `/documents` (AppShell, filtros querystring, drag & drop, tabla con permisos)

- **`src/app/documents/page.tsx` (Server Component):** guard `if (!profile) redirect("/auth/login")`, lee `searchParams` `{q, category, mime}`, `canManage = isManagementRole(profile.role)`, `Promise.all([getCategories(), getDocuments({search:q, categoryId:category, mimeType:mime})])`, render `AppShell`.
  - Header: `FileText` + descripción "Todos pueden listar y descargar; solo directiva puede subir y eliminar."
  - Card Filtros: `form method=GET` con `Input q` + `select category` (todas) + `select mime` (subset 7: pdf, doc, docx, png, jpeg, txt, csv) + botón Filtrar + `Link Limpiar` si hay filtros.
  - Card Categorías (`Folder`): `Badge` por categoría (secondary vs default si filtrada), click filtra por `?category=id`, `Link` a `/documents?category=id`, estado vacío "No hay categorías todavía."
  - `canManage && <DocumentUploader categories>` condicional.
  - Card Documentos: count + `DocumentTable` o empty state con `FileText` + mensaje diferenciado si hay filtros vs sin docs + nota "La directiva subirá los documentos..." para no-management.

- **`src/app/documents/_components/document-uploader.tsx` (client, `useState`, `useRef`):**
  - Estado `dragOver`, `uploading`, `progress`, `error/success`, `selectedFile`, `name`, `categoryId`, `showCategoryForm`.
  - Drag & drop: `onDragOver→setDragOver(true)`, `onDrop→setSelectedFile(file), if(!name) setName(file.name)`, visual `border-primary bg-primary/5` si dragOver.
  - Input file oculto + `Label Seleccionar fichero`, muestra `selectedFile.name · KB`.
  - Grid `Nombre` + `Categoría` (Sin categoría + lista).
  - Botón Subir (`disabled !selectedFile || uploading`, `Loader2` si uploading) → `FormData(name||file.name, categoryId, file)` → `createDocumentAction` → `router.refresh()` + `setSuccess`.
  - Botón `Nueva categoría` toggle form inline `Input maxLength 100` → `createDocumentCategoryAction` → refresh.
  - Mensajes: `Tipo de fichero no permitido.` / `Ya existe una categoría...` en es-ES.

- **`src/app/documents/_components/document-table.tsx` (client):**
  - Tabla `Nombre (font-medium + filePath fileName pequeño) | Categoría (Badge secondary o —) | Tipo (mime split) | Tamaño (formatFileSize) | Fecha (toLocaleDateString es-ES) | Acciones`.
  - Modo edición inline si `editingId`: `Input name` + `select categoría` + `Save/X` (Loader2 si saving) → `updateDocumentAction(FormData id,name,categoryId)`.
  - Descarga siempre visible: `<a href=/api/documents/${id}/download><Download/></a>` (todos los autenticados).
  - Editar (`Pencil`) y Eliminar (`Trash2` + confirm `"¿Eliminar este documento? Se borrará el fichero y no se puede deshacer."` + Loader2) solo si `canManage`.
  - Error banner `text-destructive`.

### D9 — Descarga segura `GET /api/documents/[id]/download` con signed URL 60s (service_role)

```ts
export async function GET(_req,{params:{id}}) {
  const profile = await getCurrentProfile(); if (!profile) 401 "No autenticado.";
  const {data,error} = await supabase.from("documents").select("file_path, mime_type, name").eq("id",id).maybeSingle();
  if (!data) 404 "Documento no encontrado.";
  const admin = createAdminClient();
  const {data:signed} = await admin.storage.from("documents").createSignedUrl(data.file_path, 60);
  if (!signed) 500 "No se pudo generar URL.";
  return NextResponse.redirect(signed.signedUrl, 302);
}
```

- Verifica sesión via `getCurrentProfile` (fail-closed); fetch `file_path` pasa por RLS `SELECT true` (authenticated puede leer). Si no existe → 404.
- Genera signed URL con **service_role** (`createAdminClient`) por 60s para bucket privado (no expone fichero público; URL expira rápido, mitiga leak por referrer/logs).
- Redirect 302 a signedUrl; cliente descarga con `mime_type`/`name` original si se añade `download` param (futuro: `?download=<name>`).
- Sin signed URL permanente; alternativa "public bucket + URL directa" descartada por privacidad.

### D10 — Navegación + tipos hand-edited (una migración)

- `src/components/layout/nav-links.ts` añade `{href:"/documents", label:"Documentos", icon:FileText}` **sin** `showFor` → visible para todos los autenticados (todos pueden listar/descargar). Orden entre Pagos y Actas.
- `src/types/database.types.ts` hand-edited: añade `document_categories` + `documents` Rows con `Relationships` (FK parent_id, created_by, category_id, uploaded_by) — coherente con migración 0076.
- Migración única `20260101007600_document_management.sql` idempotente + checklist 10 puntos + comentarios `pg_description`; reutiliza `umsuka.update_updated_at_column()` (0018) e `is_management()` (0013).

---

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Reutilizar bucket `meeting-minutes` vs bucket dedicado `documents` | Límites incompatibles (10 MB vs 20 MB, 3 mimes vs 12) y semántica: `meeting_minutes` es 1:1 con `events.reunion` vía UNIQUE, no repo genérico; mezclar rompería CHECK y políticas. |
| Almacenar fichero como `bytea` en DB vs Supabase Storage | Tamaño hasta 20 MB × N docs colapsa DB, sin CDN, sin streaming; Storage da 50 MB+json para backups y signed URLs eficientes. |
| RLS por categoría (visibilidad selectiva) | Fuera de alcance MVP; requisito es "todos ven todas" (SELECT true). RLS por categoría requeriría tabla `document_category_members` + políticas por fila + UI de permisos, añade complejidad sin beneficio inmediato; se pospone. |
| Columna `carnival_year_id` en documents | No hay partición anual; docs son atemporales (estatutos); snapshot anual ya cubre histórico vía `carnival_year_snapshots` si se requiere. |
| `file_path` generado solo con `file.name` vs `${userId}/${ts}-${rand}.${ext}` | Nombre colisiona (dos usuarios suben `Estatutos.pdf`); rand + userId + timestamp evita colisión y permite GC por usuario si se requiere. |
| Trigger `BEFORE INSERT` para validar mime vs CHECK + Zod | CHECK es declarativo y testeable sin `SECURITY DEFINER`; trigger oculta lógica y no notifica UI; Zod espeja CHECK para error es-ES antes de DB. |
| Download directo con `supabase.storage.download()` vs `createSignedUrl` 60s | `download()` stream via server consume memoria; signed URL delega a Storage CDN y expira rápido, mejor rendimiento y seguridad. |
| Bucket público con URL directa | Docs pueden ser sensibles (actas, plantillas internas); privado + signed URL evita enumeración por URL guessing. |
| Paginación server vs lista completa | MVP sin paginación (filtro DB + order); para >500 docs se añadiría `range` + `count` como en `members` (tech-debt documentado). |

---

## Consecuencias

- **Positivo:** Directiva (is_management/super_admin) puede crear categorías jerárquicas y subir/reemplazar/editar/eliminar documentos con validación triple (Zod + CHECK DB + bucket limit); miembro base solo lista/filtra/descarga (RLS + guard fail-closed). Eliminación física en Storage + BD, trazable por `uploaded_by`/`created_by` y `updated_at` (versionado básico). Migración idempotente con checklist 10 puntos, reutiliza `is_management` (0013) y `update_updated_at_column` (0018). UI accesible sin nuevas deps, drag & drop + input, filtros por querystring (shareable), badges, tabla responsive, estados vacíos diferenciados. Descarga segura con signed URL 60s vía service_role (no expone bucket público). Tipos hand-edited coherentes, `next build` 44 páginas incluye `/documents` (4.78 kB). Nav link visible para todos (consistencia con `Actuales`).
- **Negativo:** `updated_at` sobrescribe sin histórico (versionado básico); reemplazar fichero requeriría nuevo doc + borrar viejo (no upsert de fichero). `getDocuments` sin paginación: para >500 docs la respuesta crece (mitigado por filtros DB). `inferMimeFromExtension` mapea `jpg→jpeg` pero DB acepta ambos `image/jpeg` y `image/jpg` (ligera inconsistencia canónica; se preserva `image/jpg` para compat). `FilePath` con `userId/` no es jerarquía real (prefijo plano) pero útil para debug.
- **Trade-off seguridad:** `documents SELECT true` expone `file_path` a todos los autenticados (no secreto, es ruta interna bucket); sin ello no se podría generar signed URL. Mitigación: bucket privado + signed URL corta + RLS Storage `SELECT bucket_id='documents'` sin exponer fichero sin auth.
- **Trade-off UX:** `select category` en uploader muestra todas (sin árbol jerárquico visual); para jerarquía profunda se necesitaría tree view (fase 2).

---

## Seguridad

- **RLS fail-closed:** `ENABLE+FORCE` en ambas tablas; `SELECT authenticated true` (0 rows para `anon`), `ALL is_management()` para write; Storage `SELECT authenticated` + `INSERT/UPDATE/DELETE is_management()`. Non-management `INSERT document` → 42501 RLS + guard `"Solo la directiva..."` antes de DB (defensa en profundidad).
- **Validación mime/tamaño:** Zod `ALLOWED_MIME_TYPES` (12) + CHECK DB `mime_type IN (...)` + bucket `allowed_mime_types` (12) + `validateDocumentFile` con fallback extensión; triple capa evita bypass por cliente (curl con `Content-Type` falso falla en Zod/CHECK). `MAX_FILE_SIZE 20 MB` en Zod + bucket `file_size_limit` 20 MB + CHECK `file_size 1..20971520`.
- **Upload path traversal:** `filePath` generado server (`${profile.id}/${Date.now()}-${rand}.${ext}`) no usa `file.name` crudo como path (solo como `name` visible); evita `../` o colisión. `file_path` CHECK `char_length 1-500 trim >0` + UNIQUE.
- **Signed URL:** `createSignedUrl` con `service_role` (no expone `service_role` al cliente; route handler server-only); expiración 60s limita ventana si URL se filtra en logs/referrers. Sin `download` anónimo.
- **No secretos en cliente:** `createAdminClient` (service_role) solo en `mutations.ts` y `route.ts` server; `queries.ts` usa `createClient` (anon key + RLS). ESLint `no-explicit-any` + `server-only` import bloquea leak.
- **Auditoría:** `uploaded_by`/`created_by` FK SET NULL preserva fila si se borra usuario; `created_at`/`updated_at` inmutable por trigger; borrado físico trazable por ausencia de fila + best-effort remove Storage (huérfano no bloquea borrado DB).
- **Hallazgos scan:** sin issues HIGH (mismo patrón que 0071/0072/0073); 12 mimes validados en Zod están espejados en bucket/CHECK (no HIGH). Unico MEDIUM heredado de Sprint 40 (`invite_token` enumerable) no afecta a este sprint.

---

## Edge cases y trade-offs

- `upload` sin fichero o size 0 → `"Fichero no especificado."` / `"El fichero no puede estar vacío."` (Zod + guard).
- `file.type=""` (input sin mime) → fallback por extensión (`extToMime`); si ext no mapea → `"Tipo de fichero no permitido."` (ej. `.exe`).
- `file.size >20 MB` → Zod `max 20 MB` + bucket limit 20 MB → `"El fichero no puede superar 20 MB."`.
- `name` vacío + file seleccionado → `name || file.name` (fallback a nombre fichero) en `createDocumentAction`; si ambos vacíos → `"El nombre del documento es obligatorio."`.
- `categoryId` inválida (uuid no existe) → FK violation PG 23503 mapeado a `error.message` (no crash).
- `createCategory` nombre duplicado (UNIQUE) → PG 23505 → `"Ya existe una categoría con ese nombre."`.
- `createDocument` file_path colisión (rand improbable) → 23505 → `"Ya existe un documento con esa ruta."` + cleanup huérfano.
- `deleteDocument` sin `file_path` (ya borrado manual en Storage) → fetch null → `delete` DB sigue ok (best-effort remove ignora error).
- `anon` GET `/documents` → redirect `/auth/login` (page guard); `anon` SELECT `documents` → 0 rows (FORCE RLS); `anon` GET `/api/documents/:id/download` → 401.
- Member base intenta `createDocumentAction` → guard → `"Solo la directiva..."` (fail-closed); si bypass directo via `supabase.from("documents").insert` → RLS 42501 (defensa 2ª capa).
- Filtro `?q=foo&category=id&mime=application/pdf` combina `ilike` + `eq` + `order`; si `q` con `%` → `ilike` escapa `%` vía supabase (no SQLi, parameterized).
- Re-run migración idempotente: `create table if not exists`, `create index if not exists`, `drop policy/trigger if exists`, `insert bucket on conflict do update`.

---

## Verificación

Checklist idempotente migración `20260101007600` (10 puntos del DoD):

1. Tabla `umsuka.document_categories` existe con `name UNIQUE 1-100 trim>0`, `description nullable <=1000`, `parent_id FK SET NULL`, `created_by FK SET NULL`, `created_at/updated_at timestamptz default now()`, comentarios `pg_description`.
2. Tabla `umsuka.documents` existe con `name 1-200`, `file_path UNIQUE 1-500`, `file_size 1..20971520`, `mime_type 12 CHECK`, `category_id FK SET NULL`, `uploaded_by FK SET NULL`, comentarios.
3. Índices: `document_categories(parent_id, created_by, name)`, `documents(category_id, uploaded_by, mime_type, created_at desc)` + `gin_trgm_ops` en `name`.
4. Triggers `trg_document_categories_updated_at` y `trg_documents_updated_at` `before update` → `umsuka.update_updated_at_column()` (0018).
5. RLS `ENABLE+FORCE` en ambas tablas; 2 policies cada una: `SELECT authenticated true`, `ALL is_management()` + `with check is_management()`.
6. Grants: `select/insert/update/delete` a `authenticated`, `all` a `service_role` en ambas tablas.
7. Non-management `SELECT` ve filas; `INSERT/UPDATE/DELETE` falla por RLS (42501) + guard.
8. Bucket `documents` existe `public=false`, `file_size_limit=20971520`, `allowed_mime_types` 12 (pdf, doc, docx, xls, xlsx, ppt, pptx, png, jpeg, jpg, txt, csv).
9. Storage policies existen: `SELECT authenticated true`, `INSERT/UPDATE/DELETE solo is_management()` sobre `storage.objects` where `bucket_id='documents'`.
10. Re-run idempotente (`IF NOT EXISTS`, `DROP POLICY/TRIGGER IF EXISTS`, `ON CONFLICT` para bucket, `duplicate_object` si enum futuro).

Tests / build (DoD):

- `tsc --noEmit` y `eslint --max-warnings=0` limpios; `next build` sin errores (44 páginas, nueva `/documents` 4.78 kB, `/api/documents/[id]/download` route).
- Tests unitarios nuevos pasando: `documents-schema` (valid/invalid name 1-100/1-200, file_size 1..20MB, 12 mimes, `validateDocumentFile` fallback `jpg→jpeg`, `formatFileSize`), `documents-queries` con mocks (`getCategories` order name, `getDocuments` filtros search/category/mime, `getDocumentById` maybeSingle), `documents-mutations` con guards (`non-management → Solo la directiva`, `createCategory duplicate 23505`, `createDocument upload + insert + cleanup huérfano`, `deleteDocument remove best-effort`) + suite completa `npx vitest run` sin regresiones.
- Security scan sin issues **HIGH** (sin secretos, sin bypass RLS, sin exposición `service_role` en cliente; signed URL 60s con `service_role` server-only).

---

## Cambios

- `supabase/migrations/20260101007600_document_management.sql` — CREATE (2 tablas, CHECKs, índices, triggers, RLS + grants, bucket `documents` privado 20 MB 12 mimes + 4 storage policies, checklist 10 pts).
- `src/types/database.types.ts` — `document_categories` + `documents` Row/Insert/Update con Relationships `parent_id`, `created_by`, `category_id`, `uploaded_by`.
- `src/lib/documents/schema.ts` — `ALLOWED_MIME_TYPES` (12) + `MAX_FILE_SIZE 20MB` + `MIME_LABELS` + `isAllowedMimeType` + Zod `createCategorySchema` (name 1-100), `createDocumentSchema` (name 1-200, category_id uuid nullable, filePath 1-500, fileSize 1..20MB, mime 12), `updateDocumentSchema`, `deleteDocumentSchema`, `validateDocumentFile` con fallback extensión (jpg/jpeg→jpeg), `formatFileSize`, `inferMimeFromExtension` (mensajes es-ES).
- `src/lib/documents/queries.ts` — `getCategories` (order name asc), `getDocuments` (filtros search ilike + categoryId + mimeType, order created_at desc, join `document_categories(name)`), `getDocumentById` (maybeSingle), mappers snake→camel server-only.
- `src/lib/documents/mutations.ts` — `createCategory`, `updateCategory`, `deleteCategory`, `createDocument` (validate + inferMime + upload `admin.storage` con `${userId}/${ts}-${rand}.${ext}` upsert false + insert + cleanup huérfano), `updateDocument`, `deleteDocument` (fetch file_path → delete DB → `admin.storage.remove` best-effort) con guard `requireManagementGuard` fail-closed (`isManagementRole`).
- `src/lib/documents/actions.ts` — `createDocumentCategoryAction`, `deleteDocumentCategoryAction`, `createDocumentAction` (FormData name/categoryId/file), `updateDocumentAction`, `deleteDocumentAction` thin con `revalidatePath("/documents")` (use server).
- `src/app/documents/page.tsx` — Server Component (AppShell) con filtros GET `q/category/mime`, categorías badges, `DocumentUploader` condicional `canManage`, `DocumentTable`, estados vacíos, `isManagementRole` guard.
- `src/app/documents/_components/document-uploader.tsx` — client drag & drop (dragOver, fileRef, progress `Subiendo...`, error/success es-ES), creación inline categorías, validación tipo/tamaño.
- `src/app/documents/_components/document-table.tsx` — tabla Nombre/Categoría/Tipo/Tamaño/Fecha/Acciones, edición inline nombre/categoría (solo directiva), descarga vía `/api/documents/[id]/download` (todos), eliminar con `confirm` (solo directiva), `formatFileSize`.
- `src/app/api/documents/[id]/download/route.ts` — `GET` verifica `getCurrentProfile` 401, fetch `file_path` 404, `createAdminClient().storage.from("documents").createSignedUrl(file_path, 60)` → `302 redirect` (privado).
- `src/components/layout/nav-links.ts` — añade `{href:"/documents", label:"Documentos", icon:FileText}` visible para todos los autenticados (sin `showFor`).
- `tests/unit/lib/documents-schema.test.ts` — 8 tests (schemas valid/invalid, fallback, tamaño).
- `tests/unit/lib/documents-queries.test.ts` — 5 tests (filtros, mocks Supabase).
- `tests/unit/lib/documents-mutations.test.ts` — 9 tests (guards management/base, duplicate 23505, upload, delete).
- `docs/adr-sprint-41-document-management.md` — este ADR.
- `tasks/sprint-41-document-management.json` — task (branch `feature/sprint-41-document-management`, status `validated` → `documented`).

---

## Referencias

- `tasks/sprint-41-document-management.json` (AC 6 + DoD 13 + dependencies Sprint 21/2/16)
- `tasks/plan-desarrollo-completo.md` §Sprint 41
- `docs/git-conventions.md` — `feature/sprint-41-document-management`, commits `feat(sprint-41): ...`, PR `[feature] Sprint 41 — ...` contra `master`
- `supabase/migrations/20260101007300_pre_register_link.sql` (patrón ENUM + RLS + helper, última migración previa)
- `supabase/migrations/20260101007100_meeting_minutes.sql` (Storage RLS patrón 3 mimes 10 MB, reutilizado para 12 mimes 20 MB)
- `src/lib/meetings/schema.ts` (Zod mensajes es-ES + `validateFile` fallback, patrón para `validateDocumentFile`)
- `src/lib/meetings/mutations.ts` + `src/lib/carnival/year.ts` (guard `isManagementRole` fail-closed, `admin` bypass, `revalidatePath` thin actions)
- `src/lib/supabase/admin.ts` (`createAdminClient` service_role), `src/lib/auth/session.ts` (`getCurrentProfile`), `src/lib/auth/roles.ts` (`isManagementRole`)
- `docs/adr-sprint-40-pre-register-link-gmail.md` (plantilla ADR detallada con D1..D9, Verificación checklist 10, Seguridad MEDIUM)
- `docs/adr-sprint-34-meeting-minutes-summary.md` (Storage bucket privado patrón, trigger check reunion)
- `docs/adr-sprint-38-new-carnival-year.md` (carnival_year_id nullable, bucket `carnival-backups` 50 MB json)
