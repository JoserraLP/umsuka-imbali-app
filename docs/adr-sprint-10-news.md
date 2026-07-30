# ADR-010: Sprint 10 — Módulo de Noticias (News Publication & Management)

**Status:** Accepted · **Date:** 2026-07-30

---

## Context

La Umsuka Imbali App carecía de un canal de comunicación interna para publicar anuncios, novedades y noticias dirigidas a todos los miembros. Hasta el Sprint 9, la tabla `umsuka.news` existía como estructura mínima en el esquema de base de datos pero sin funcionalidad operativa ni interfaz de usuario.

Se requería un sistema completo de publicación y gestión de noticias que permitiera:

- **Management**: crear, editar, eliminar y fijar noticias (pinned).
- **Todos los miembros autenticados**: visualizar un feed de noticias y el detalle de cada una.
- **Control de publicación**: modelo borrador/publicado (draft/published) para preparar contenido antes de hacerlo visible.
- **Imagen destacada**: opción de asociar una imagen URL a cada noticia.
- **Feed ordenado**: noticias fijadas (pinned) al inicio, seguidas por las más recientes primero.
- **Seguridad**: solo management puede crear/modificar/eliminar; los miembros regulares solo lectura de noticias publicadas.
- **Defensa en profundidad**: filtrado tanto en capa de aplicación como en RLS de base de datos.

### Dependencias

- Sprint 1 (UI/UX) — Componentes base (`AppShell`, `Badge`, `Button`, diseño de tarjetas).

---

## Decisión

Se implementó un módulo completo de noticias siguiendo el patrón arquitectónico establecido en el proyecto (3 capas: schema Zod → queries/mutations → server actions), con las siguientes decisiones:

### 1. Migración de base de datos — `20260101003800_news_enhancement.sql`

Se modificó la tabla existente `umsuka.news` añadiendo tres columnas:

| Columna | Tipo | Default | Descripción |
|---------|------|---------|-------------|
| `image_url` | `text` | `null` | URL opcional de imagen destacada |
| `published` | `boolean NOT NULL` | `false` | Control borrador/publicado |
| `pinned` | `boolean NOT NULL` | `false` | Fijar noticia al inicio del feed |

Se crearon/se actualizaron los siguientes índices:

```sql
create index idx_news_pinned on umsuka.news (pinned desc);
drop index if exists umsuka.idx_news_created_at;
create index idx_news_created_at on umsuka.news (created_at desc);
```

**Actualización de RLS**: Se reemplazó la política `news_select_authenticated` para que los usuarios sin rol de management solo puedan ver filas con `published = true`. Management puede ver todas (publicadas y borradores).

```sql
create policy "news_select_authenticated"
  on umsuka.news for select
  to authenticated
  using (
    umsuka.is_management() OR published = true
  );
```

### 2. Capa de negocio — `src/lib/news/`

Organizada en tres archivos siguiendo la arquitectura del proyecto:

#### `schema.ts` — Schemas Zod

| Schema | Extiende | Campos | Propósito |
|--------|----------|--------|-----------|
| `newsFormSchema` | — | `title`, `content`, `image_url`, `published`, `pinned` | Base compartida para formularios |
| `createNewsSchema` | `newsFormSchema` | (mismos) | Validación de creación |
| `updateNewsSchema` | `newsFormSchema` | + `id: uuid` | Validación de actualización |
| `deleteNewsSchema` | — | `id: uuid` | Validación de eliminación |
| `togglePinSchema` | — | `id: uuid` | Validación de fijar/destacar |

**Detalles de validación:**
- `title`: obligatorio, trim, 1–200 caracteres.
- `content`: obligatorio, trim, 1–10.000 caracteres.
- `image_url`: `z.string().url()` opcional; string vacío y `null` se transforman a `null`.
- `published` / `pinned`: booleanos con default `false`.
- Todos los mensajes de error en español.

#### `queries.ts` — Consultas

| Función | Descripción | Filtro de publicación |
|---------|-------------|----------------------|
| `getNewsFeed(includeUnpublished?)` | Feed completo ordenado por pinned DESC + created_at DESC | `includeUnpublished=false` (default) → solo `published=true` |
| `getNewsById(id, includeUnpublished?)` | Noticia individual con datos de autor | Mismo comportamiento que el feed |
| `getPinnedNews()` | Solo noticias publicadas y fijadas | `published=true` + `pinned=true` |

Todas las funciones realizan un JOIN con `profiles` para incluir nombre y apellido del autor, y mapean los resultados a `NewsItem` (camelCase) mediante `mapNewsRow()`.

#### `mutations.ts` — Mutaciones

Todas las mutaciones están protegidas por `requireManagement()`:

| Función | Operación | Validación Zod | Autorización |
|---------|-----------|----------------|--------------|
| `createNews(input)` | INSERT en `news` | `createNewsSchema` | `assertManagement()` |
| `updateNews(input)` | UPDATE por id | `updateNewsSchema` | `assertManagement()` |
| `deleteNews(input)` | DELETE por id | `deleteNewsSchema` | `assertManagement()` |
| `togglePin(input)` | UPDATE toggle `pinned` | `togglePinSchema` | `assertManagement()` |

`togglePin()` implementa un patrón de fetch-then-toggle: primero obtiene el valor actual de `pinned`, luego actualiza con `!current.pinned`. Esto evita que el cliente tenga que conocer el estado actual.

### 3. Server Actions — `src/app/news/actions.ts`

Wrappers `"use server"` delgados que delegan en `mutations.ts` y revalidan rutas tras éxito:

| Action | Delega en | Revalida |
|--------|-----------|----------|
| `createNewsAction` | `createNews()` | `/news` |
| `updateNewsAction` | `updateNews()` | `/news`, `/news/[id]` |
| `deleteNewsAction` | `deleteNews()` | `/news` |
| `togglePinAction` | `togglePin()` | `/news`, `/news/[id]` |

### 4. UI — Páginas y componentes

#### `/news` — Feed de noticias (server component)

- Tarjetas estilo red social con imagen destacada opcional, título, preview del contenido (truncado a 200 caracteres), autor y fecha.
- Las noticias fijadas muestran un badge "Destacada" con icono `Pin`.
- Las noticias en estado borrador muestran un badge "Borrador" con icono `EyeOff` (solo visible para management).
- Las tarjetas fijadas tienen un anillo visual (`ring-1 ring-primary/20`).
- Botón "Nueva noticia" en el header, visible solo para management.
- Estado vacío con mensajes contextuales según el rol.
- Layout responsivo: imagen `h-48` en mobile, `h-56` en sm+.

#### `/news/[id]` — Detalle de noticia (server component)

- Artículo completo con imagen destacada (`h-56` a `h-96` según viewport), título, autor, fecha con hora, y contenido.
- Badges de estado (Destacada / Borrador).
- Panel de acciones de administración visible solo para management:
  - **Editar**: link a `/news/[id]/edit`
  - **Fijar/Quitar destacada**: form action inline que llama a `togglePinAction`
  - **Eliminar**: form action inline con confirmación `confirm()` en cliente + `deleteNewsAction` en servidor
- Meta tags dinámicos vía `generateMetadata`.

#### `/news/new` — Crear noticia (server component)

- Renderiza `NewsForm` en modo `create`.
- Redirige a `/news` si el usuario no tiene rol management.
- Valores por defecto: `published: true`, `pinned: false`.

#### `/news/[id]/edit` — Editar noticia (server component)

- Renderiza `NewsForm` en modo `edit` con valores actuales de la noticia.
- Redirige a `/news` si el usuario no tiene rol management.
- Muestra 404 si la noticia no existe.

#### `news-form.tsx` — Formulario reutilizable (client component)

- `"use client"` con React Hook Form + Zod (`@hookform/resolvers/zod`).
- Props: `mode` ("create" | "edit"), `newsId` (opcional), `defaultValues`.
- Campos:
  - **Título**: Input de texto.
  - **Contenido**: textarea de 12 filas.
  - **URL de imagen destacada**: Input type="url" con placeholder.
  - **Publicada**: checkbox.
  - **Destacada (fijada al inicio)**: checkbox.
- Manejo de errores: muestra errores de validación por campo y error general del servidor.
- En éxito: redirige a `/news/[id]` (o `/news` si no hay id).
- Botón de submit con estado de carga ("Guardando…").

### 5. Navegación

Se añadió el enlace "Noticias" con icono `Newspaper` en `nav-links.ts` entre "Calendario" y "Mi perfil":

```typescript
{ href: "/news", label: "Noticias", icon: Newspaper },
```

Este enlace es visible para todos los roles autenticados y se renderiza tanto en el sidebar como en el bottom-nav (ambos consumen `nav-links.ts`).

### 6. Tests

30 tests unitarios (19 schema + 11 queries) todos pasando:

#### `schema.test.ts` — 19 tests

| Suite | Tests | Cobertura |
|-------|-------|-----------|
| `newsFormSchema` | 12 | Acepta payload válido; rechaza título vacío; rechaza título > 200 chars; rechaza contenido vacío; rechaza contenido > 10000 chars; transforma image_url vacío a null; acepta URL válida; rechaza URL inválida; defaults published/pinned a false; acepta valores explícitos true |
| `createNewsSchema` | 1 | Acepta mismo payload que newsFormSchema |
| `updateNewsSchema` | 2 | Rechaza UUID inválido; acepta UUID válido |
| `deleteNewsSchema` | 2 | Rechaza id vacío; acepta UUID válido |
| `togglePinSchema` | 2 | Rechaza UUID inválido; acepta UUID válido |

#### `queries.test.ts` — 11 tests

| Suite | Tests | Cobertura |
|-------|-------|-----------|
| `getNewsFeed` | 5 | Filtra unpublished cuando `includeUnpublished=false`; retorna todos cuando `true`; array vacío sin datos; error propagado; mapeo correcto de author |
| `getNewsById` | 4 | Retorna item encontrado; filtra unpublished cuando `includeUnpublished=false`; retorna null si no existe; error propagado |
| `getPinnedNews` | 2 | Retorna solo published+pinned; array vacío sin pinned |

#### Configuración de Vitest

Se actualizó `vitest.config.ts` para incluir `src/lib/**/__tests__/**/*.test.{ts,tsx}` como ruta de búsqueda de tests, permitiendo que los tests colocalizados con los módulos sean descubiertos automáticamente.

### 7. Seguridad

#### Autorización (capa de aplicación)

- Todas las mutaciones requieren `requireManagement()` vía `assertManagement()`.
- Las páginas de creación/edición redirigen a `/news` si el usuario no tiene rol management.
- `getNewsFeed` y `getNewsById` aceptan `includeUnpublished` default `false`; la página de detalle pasa `canManage` como segundo argumento para que management pueda ver borradores.

#### RLS (defensa en profundidad)

La política `news_select_authenticated` a nivel de base de datos replica la lógica de la capa de aplicación: management ve todas las filas; otros usuarios autenticados solo ven `published = true`.

#### Seguridad de datos

- No se almacenan contraseñas, secrets ni tokens en el módulo.
- No hay vectores de inyección SQL (todas las consultas usan el query builder de Supabase).
- Security scan: 2 hallazgos MEDIUM encontrados y corregidos (no se especifican detalles adicionales).

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Frontend (Server Components + Client Components)                            │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │ /news (feed)     │  │ /news/[id]       │  │ /news/new (create)        │  │
│  │ Server component │  │ Server component │  │ /news/[id]/edit (edit)   │  │
│  │ Tarjetas + badges│  │ Artículo +       │  │ ┌──────────────────────┐ │  │
│  │ Botón "Nueva"    │  │ Management panel │  │ │ NewsForm             │ │  │
│  └────────┬─────────┘  └────────┬─────────┘  │ │ (React Hook Form    │ │  │
│           │                     │            │ │  + Zod resolver)     │ │  │
│           │                     │            │ └──────────────────────┘ │  │
│           │                     │            └──────────────────────────┘  │
└───────────┼─────────────────────┼──────────────────────────────────────────┘
            │                     │
┌───────────▼─────────────────────▼──────────────────────────────────────────┐
│  Server Actions (src/app/news/actions.ts)                                   │
│  createNewsAction / updateNewsAction / deleteNewsAction / togglePinAction  │
│  (revalidatePath on success)                                               │
└───────────┬────────────────────────────────────────────────────────────────┘
            │
┌───────────▼────────────────────────────────────────────────────────────────┐
│  Application Layer (src/lib/news/)                                          │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │ schema.ts       │  │ queries.ts       │  │ mutations.ts             │  │
│  │ (Zod schemas)   │  │ getNewsFeed      │  │ createNews / updateNews  │  │
│  │ create/update/  │  │ getNewsById      │  │ deleteNews / togglePin   │  │
│  │ delete/togglePin│  │ getPinnedNews    │  │ (gate: requireManagement)│  │
│  └─────────────────┘  └────────┬─────────┘  └───────────┬──────────────┘  │
└────────────────────────────────┼────────────────────────┼──────────────────┘
                                 │                        │
┌────────────────────────────────▼────────────────────────▼──────────────────┐
│  Supabase (RLS enforced)                                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ umsuka.news                                                          │  │
│  │ Políticas:                                                           │  │
│  │ SELECT: is_management() OR published = true                          │  │
│  │ INSERT/UPDATE/DELETE: (gestionadas por application layer + RLS)      │  │
│  │ Índices: idx_news_pinned, idx_news_created_at                        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Flujo de creación de noticia

```
┌────────────┐     ┌──────────────┐     ┌──────────────┐     ┌───────────────┐
│ NewsForm   │     │ createNews-  │     │ createNews   │     │ Supabase      │
│ (cliente)  │     │ Action       │     │ (mutations)  │     │ (RLS + data)  │
├────────────┤     ├──────────────┤     ├──────────────┤     ├───────────────┤
│ 1. User    │────>│ 2. recibe    │────>│ 3. Zod parse │────>│ 4. INSERT     │
│    llena   │     │    input     │     │    + auth    │     │    news       │
│    form    │     │              │     │    + insert  │     │    row        │
│ 6. router  │<────│ 5. return    │<────│ 4. return id │<────│ 5. row id     │
│    push()  │     │    success   │     │              │     │               │
│    +       │     │              │     │              │     │               │
│ 7. redir   │     │              │     │              │     │               │
│    /news/id│     │              │     │              │     │               │
└────────────┘     └──────────────┘     └──────────────┘     └───────────────┘
```

---

## Decisiones arquitectónicas clave

| # | Decisión | Alternativa considerada | Razón |
|---|----------|------------------------|-------|
| 1 | **URL-only image storage** | Subida de archivos (file upload) | MVP scope; la subida de archivos requeriría bucket de storage, manejo de permisos, y componentes adicionales. Se difiere a sprint futuro. |
| 2 | **Draft/published model** | Solo publicado/inmediato | Permite preparar contenido antes de hacerlo visible; `published=false` como default fuerza decisión explícita de publicación. |
| 3 | **Sin paginación** | Paginación cursor/offset | MVP scope; el volumen esperado de noticias es bajo (< 100). La paginación puede añadirse después sin cambios breaking. |
| 4 | **Ruta dedicada `/news/[id]/edit`** | Edición inline en la misma página | Separa concerns de lectura y escritura; simplifica el cache de Next.js (revalidatePath en lugar de revalidateTag); evita estado complejo de edición en el cliente. |
| 5 | **Management role para CRUD; solo lectura para authenticated** | Roles más granulares (editor, etc.) | Simplicidad: los management roles existentes (`super_admin`, `admin`, `board_member`, `event_manager`) ya tienen acceso. Un rol "editor" podría añadirse en el futuro. |
| 6 | **Spread de field definitions en Zod** | `.extend()` con ZodEffects | Consistencia con Sprint 8 (shifts): el spread de objetos planos evita problemas de tipado y herencia de refinements con schemas que contienen `.refine()`. |
| 7 | **`togglePin()` fetch-then-toggle** | Cliente envía el nuevo valor | El servidor es la fuente de verdad; evita condiciones de carrera si dos administradores modifican el mismo item simultáneamente. |

---

## Edge cases manejados

### Validación de schemas (19 tests)

| Escenario | Comportamiento |
|-----------|----------------|
| Título vacío | Rechazado: "El título es obligatorio." |
| Título > 200 caracteres | Rechazado |
| Contenido vacío | Rechazado: "El contenido es obligatorio." |
| Contenido > 10000 caracteres | Rechazado |
| `image_url` vacío (`""`) | Transformado a `null` |
| `image_url` = `null` | Aceptado (opcional) |
| `image_url` inválido (no URL) | Rechazado: "La URL de la imagen no es válida." |
| `published` / `pinned` no proporcionados | Default `false` |
| `id` UUID inválido en update/delete/toggle | Rechazado |

### Seguridad y autorización

| Escenario | Comportamiento |
|-----------|----------------|
| Miembro regular visita `/news/new` | Redirigido a `/news` |
| Miembro regular visita `/news/[id]/edit` | Redirigido a `/news` |
| Miembro regular ejecuta `createNewsAction` | Error de autorización |
| Miembro regular ve noticia no publicada | `getNewsById` retorna `null` → 404 |
| Management ve noticia no publicada | Visible (pasa `canManage=true` a `getNewsById`) |
| RLS a nivel BD para non-management | Fila con `published=false` invisible (defensa en profundidad) |

### Queries

| Escenario | Comportamiento |
|-----------|----------------|
| Feed sin noticias | Array vacío → mensaje "No hay noticias todavía" |
| Noticia no encontrada por ID | `getNewsById` retorna `null` → 404 |
| Error de base de datos | Error propagado con mensaje en español |
| Noticia sin perfil de autor | `authorFirstName` = "Miembro", `lastName` = "" |

---

## Consecuencias

### Positivas

- Sistema completo de publicación de noticias con creación, edición, eliminación y fijación.
- Modelo borrador/publicado que permite preparar contenido antes de su publicación.
- Feed visual tipo red social con tarjetas, imágenes destacadas y badges de estado.
- Defensa en profundidad: validación Zod + autorización en servidor + RLS.
- Consultas optimizadas con JOIN a `profiles` para datos de autor en una sola llamada.
- Las noticias fijadas aparecen siempre al inicio del feed, seguidas por las más recientes.
- El panel de administración (editar, fijar, eliminar) es contextual y solo visible para management.
- 30 nuevos tests (19 schema + 11 queries) con 0 regresiones.
- Sin hallazgos HIGH en security scan.
- Reutilización del patrón de 3 capas establecido en sprints anteriores.
- Formulario reutilizable `NewsForm` compartido entre creación y edición.

### Negativas / Riesgos

- **Sin paginación**: a medida que crezca el número de noticias, el feed completo podría volverse lento. Se debe implementar paginación (cursor o infinite scroll) en sprint futuro.
- **Sin subida de imágenes**: `image_url` acepta URLs externas, lo que significa que las imágenes pueden romperse si el host externo las elimina. No hay almacenamiento propio ni proxy de imágenes.
- **Sin notificaciones**: cuando se publica una noticia, no se envía ninguna notificación push ni email a los miembros. Deben entrar manualmente a la app para ver las novedades.
- **Sin borrado lógico (soft delete)**: `deleteNews` elimina físicamente la fila. No hay papelera de reciclaje ni restauración.
- **Sin editor enriquecido**: el contenido usa un textarea plano. No soporta formato (negrita, listas, enlaces incrustados). Para notas largas, la experiencia de escritura es limitada.

### Técnicas

- Se migró la tabla `umsuka.news` con `ADD COLUMN IF NOT EXISTS` implícito (la migración es idempotente para las columnas añadidas).
- Se recreó el índice `idx_news_created_at` (drop + create) para asegurar orden descendente.
- Se añadió el índice `idx_news_pinned` en la columna `pinned` para optimizar el ordenamiento del feed.
- Se actualizó `src/types/database.types.ts` con los nuevos campos en `news` (`image_url`, `published`, `pinned`).
- Se actualizó `vitest.config.ts` para incluir tests colocalizados (`src/lib/**/__tests__/`).
- Se añadió la dependencia `@hookform/resolvers` para integración React Hook Form + Zod.
- La navegación (sidebar y bottom-nav) actualiza automáticamente el enlace "Noticias" sin necesidad de cambios adicionales, gracias a que ambas consumen `nav-links.ts`.

---

## Archivos Modificados/Creados

| Archivo | Acción |
|---------|--------|
| `supabase/migrations/20260101003800_news_enhancement.sql` | CREATE |
| `src/lib/news/schema.ts` | CREATE |
| `src/lib/news/queries.ts` | CREATE |
| `src/lib/news/mutations.ts` | CREATE |
| `src/lib/news/__tests__/schema.test.ts` | CREATE |
| `src/lib/news/__tests__/queries.test.ts` | CREATE |
| `src/app/news/actions.ts` | CREATE |
| `src/app/news/page.tsx` | CREATE |
| `src/app/news/news-form.tsx` | CREATE |
| `src/app/news/[id]/page.tsx` | CREATE |
| `src/app/news/[id]/edit/page.tsx` | CREATE |
| `src/app/news/new/page.tsx` | CREATE |
| `tasks/sprint-10-news.json` | CREATE |
| `src/types/database.types.ts` | MODIFY — added `image_url`, `published`, `pinned` to `news` Row/Insert/Update |
| `src/components/layout/nav-links.ts` | MODIFY — added `Newspaper` icon and `Noticias` nav link |
| `vitest.config.ts` | MODIFY — added `src/lib/**/__tests__/**/*.test.{ts,tsx}` include pattern |
