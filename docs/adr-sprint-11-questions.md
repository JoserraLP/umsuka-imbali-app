# ADR-011: Sprint 11 — Módulo de Preguntas (Questions & Community Discussion)

**Status:** Accepted · **Date:** 2026-07-30

---

## Context

La Umsuka Imbali App carecía de un canal estructurado para que los miembros plantearan preguntas, dudas o consultas a la comunidad y recibieran respuestas o seguimiento por parte de management. Hasta el Sprint 10, la tabla `umsuka.questions` existía como estructura mínima en el esquema de base de datos pero sin funcionalidad operativa ni interfaz de usuario.

Se requería un sistema completo de preguntas y discusión que permitiera:

- **Cualquier miembro autenticado**: crear preguntas con categoría y prioridad, añadir comentarios a preguntas existentes.
- **Management y creador de la pregunta**: marcar preguntas como resueltas/reabrir, eliminar preguntas.
- **Filtrado y búsqueda**: filtrar preguntas por estado (abiertas/resueltas/todas), categoría, y "solo mis preguntas" mediante URL search params.
- **Discusión**: sistema de comentarios por pregunta con orden ascendente.
- **Categorización**: preguntas organizadas por categorías (general, ensayo, evento, vestuario, música, otro) y prioridades (baja, media, alta).
- **Seguridad**: defensa en profundidad con validación Zod + autorización en servidor + RLS en base de datos.

### Dependencias

- Sprint 1 (UI/UX) — Componentes base (`AppShell`, `Badge`, `Button`, diseño de tarjetas).
- Sprint 9 (Auth) — Sistema de roles y autenticación.

---

## Decisión

Se implementó un módulo completo de preguntas siguiendo el mismo patrón arquitectónico del Módulo de Noticias (Sprint 10): 3 capas (schema Zod → queries/mutations → server actions), con las siguientes decisiones:

### 1. Migración de base de datos — `20260101003900_questions_rls_enhancement.sql`

Se modificó la tabla existente `umsuka.questions` añadiendo dos columnas:

| Columna | Tipo | Default | Descripción |
|---------|------|---------|-------------|
| `category` | `text` | `null` | Categoría de la pregunta (general, ensayo, evento, vestuario, musica, otro) |
| `priority` | `text` | `null` | Prioridad (baja, media, alta) |

Se crearon los siguientes índices:

```sql
create index idx_questions_category on umsuka.questions (category);
create index idx_questions_priority on umsuka.questions (priority);
```

Se creó la nueva tabla `umsuka.question_comments` con foreign key a `questions(id)` y `ON DELETE CASCADE`:

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | `uuid PK` | Default `gen_random_uuid()` |
| `question_id` | `uuid NOT NULL` | FK → `umsuka.questions(id)` con cascade delete |
| `user_id` | `uuid NOT NULL` | FK → `auth.users(id)` |
| `content` | `text NOT NULL` | Contenido del comentario |
| `created_at` | `timestamptz` | Default `now()` |

Se creó el índice `idx_question_comments_question_id` en la columna `question_id`.

**Políticas RLS** — se reemplazaron las políticas existentes y se definieron las siguientes:

#### Tabla `umsuka.questions`

| Operación | Política | Destinatarios |
|-----------|----------|---------------|
| `SELECT` | `any_auth_user_can_select_questions` | Todos los usuarios autenticados (`auth.role() = 'authenticated'`) |
| `INSERT` | `any_auth_user_can_insert_questions` | Todos los usuarios autenticados |
| `UPDATE` | `creator_or_management_can_update_questions` | El creador (`auth.uid() = user_id`) **o** management (`super_admin`, `admin`, `board_member`, `event_manager`) |
| `DELETE` | `creator_or_management_can_delete_questions` | El creador **o** management |

#### Tabla `umsuka.question_comments`

| Operación | Política | Destinatarios |
|-----------|----------|---------------|
| `SELECT` | `any_auth_user_can_select_comments` | Todos los usuarios autenticados |
| `INSERT` | `any_auth_user_can_insert_comments` | Todos los usuarios autenticados |
| `UPDATE` | `creator_can_update_comment` | Solo el autor del comentario (`auth.uid() = user_id`) |
| `DELETE` | `creator_or_management_can_delete_comments` | El autor del comentario **o** management |

### 2. Capa de negocio — `src/lib/questions/`

Organizada en tres archivos siguiendo la arquitectura del proyecto:

#### `schema.ts` — Schemas Zod

| Schema | Extiende | Campos | Propósito |
|--------|----------|--------|-----------|
| `questionFormSchema` | — | `title`, `content`, `category`, `priority` | Base compartida para formularios |
| `createQuestionSchema` | `questionFormSchema` | (mismos) | Validación de creación |
| `updateQuestionSchema` | `questionFormSchema.extend()` | + `id: uuid` | Validación de actualización |
| `deleteQuestionSchema` | — | `id: uuid` | Validación de eliminación |
| `resolveQuestionSchema` | — | `id: uuid`, `resolved: boolean` | Validación de resolver/reabrir |
| `addCommentSchema` | — | `question_id: uuid`, `content: string` | Validación de comentarios |

**Constantes compartidas:**

- `QUESTION_CATEGORIES`: `["general", "ensayo", "evento", "vestuario", "musica", "otro"]`
- `QUESTION_PRIORITIES`: `["baja", "media", "alta"]`

**Detalles de validación:**
- `title`: obligatorio, trim, 1–200 caracteres.
- `content`: obligatorio, trim, 1–5.000 caracteres.
- `category`: enum con default `"general"`.
- `priority`: enum con default `"media"`.
- `content` (comentario): obligatorio, trim, 1–2.000 caracteres.
- Todos los mensajes de error en español.

#### `queries.ts` — Consultas

| Función | Descripción |
|---------|-------------|
| `getQuestions(filters?)` | Lista de preguntas con filtros opcionales: `status` (open/resolved/all), `category`, `mine`, `userId`. Ordenadas por `created_at DESC`. |
| `getQuestionById(id)` | Pregunta individual con datos de autor. Retorna `null` si no existe. |
| `getQuestionComments(questionId)` | Comentarios de una pregunta ordenados por `created_at ASC`. |

**Optimización N+1:** `getQuestions()` primero obtiene las filas de preguntas, recolecta todos los `user_id`, luego hace una sola consulta `IN (userIds...)` a `profiles`, y ensambla los resultados con `Map` en O(n). Misma estrategia que `getEventShifts()` en Sprint 8 y `getNewsFeed()` en Sprint 10.

**Mapeo a camelCase:** Las funciones `mapQuestionRow()` → `QuestionItem` y el mapeo inline de comentarios convierten `snake_case` de Supabase a `camelCase` para el frontend. Los nombres de autor por defecto son "Miembro" / "" cuando no hay perfil asociado.

#### `mutations.ts` — Mutaciones

| Función | Operación | Validación Zod | Autorización |
|---------|-----------|----------------|--------------|
| `createQuestion(input)` | INSERT en `questions` | `createQuestionSchema` | `requireAuthenticatedProfile()` — cualquier auth |
| `updateQuestion(input)` | UPDATE por id | `updateQuestionSchema` | `assertCanModifyQuestion()` — creador o management |
| `deleteQuestion(input)` | DELETE por id | `deleteQuestionSchema` | `assertCanModifyQuestion()` — creador o management |
| `resolveQuestion(input)` | UPDATE `resolved` | `resolveQuestionSchema` | `assertCanModifyQuestion()` — creador o management |
| `addComment(input)` | INSERT en `question_comments` | `addCommentSchema` | `requireAuthenticatedProfile()` — cualquier auth |

**`assertCanModifyQuestion(questionId)`** — Función de autorización que:
1. Verifica que el usuario está autenticado (`requireAuthenticatedProfile()`).
2. Si tiene rol management → permiso concedido.
3. Si no, consulta `user_id` de la pregunta. Si coincide con `actor.id` → permiso concedido.
4. En cualquier otro caso → retorna error `"No tienes permisos para modificar esta pregunta."`.

### 3. Server Actions — `src/app/questions/actions.ts`

Wrappers `"use server"` delgados que delegan en `mutations.ts` y revalidan rutas tras éxito:

| Action | Delega en | Revalida |
|--------|-----------|----------|
| `createQuestionAction` | `createQuestion()` | `/questions` |
| `updateQuestionAction` | `updateQuestion()` | `/questions`, `/questions/[id]` |
| `deleteQuestionAction` | `deleteQuestion()` | `/questions` |
| `resolveQuestionAction` | `resolveQuestion()` | `/questions`, `/questions/[id]` |
| `addCommentAction` | `addComment()` | `/questions/[question_id]` |

### 4. UI — Páginas y componentes

#### `/questions` — Lista de preguntas (server component)

- Header con título y botón "Nueva pregunta" visible para todos los autenticados.
- **Filtros URL-based**:
  - Tabs de estado: `Todas` / `Abiertas` / `Resueltas` — enlaces que actualizan `?status=`.
  - Select de categoría: cambia `?category=` y recarga la página.
  - Toggle "Solo mis preguntas": enlace que añade/remueve `?mine=true`.
- Cada pregunta se muestra como tarjeta (`Link`) con:
  - Badges: estado (Resuelta/Abierta), categoría, prioridad (con variantes de color: secondary/default/destructive).
  - Título, preview del contenido (`line-clamp-2`), autor y fecha.
- Estado vacío con mensaje contextual según filtros activos.

#### `/questions/new` — Crear pregunta (server component)

- Renderiza `QuestionForm` con valores por defecto (`title: ""`, `content: ""`, `category: "general"`, `priority: "media"`).
- Redirige a `/auth/login` si no hay sesión.
- Meta title: "Nueva pregunta".

#### `question-form.tsx` — Formulario de creación (client component)

- `"use client"` con React Hook Form + Zod (`@hookform/resolvers/zod`).
- Campos: Título (input), Descripción (textarea 8 filas), Categoría (select), Prioridad (select).
- Manejo de errores: errores de validación por campo + error general del servidor.
- En éxito: redirige a `/questions/[id]`.
- Botón de submit con estado de carga ("Publicando…").
- Sin modo edición (a diferencia de NewsForm que tiene modo create/edit compartido). Las preguntas no tienen página de edición en este sprint.

#### `/questions/[id]` — Detalle de pregunta (server component)

- Artículo completo con:
  - Link "Volver a preguntas".
  - Badges: estado, categoría, prioridad.
  - Título, autor con fecha y hora, contenido (con `whitespace-pre-line`).
- **Panel de acciones** (visible solo para creador o management):
  - `ResolveButton`: botón que alterna entre "Marcar como resuelta" / "Reabrir".
  - `DeleteQuestionButton`: botón "Eliminar" con confirmación `confirm()` en cliente.
- **Sección de comentarios**:
  - Lista de comentarios con avatar placeholder, nombre del autor, fecha, contenido.
  - Estado vacío cuando no hay comentarios.
  - `AddCommentForm` al final.

#### `resolve-button.tsx` — Botón resolver/reabrir (client component)

- Form action inline que llama a `resolveQuestionAction` con `resolved: !resolved`.
- Usa `CheckCircle2` / `RotateCcw` icons según estado actual.

#### `delete-question-button.tsx` — Botón eliminar (client component)

- Form action inline con `confirm()` antes de llamar a `deleteQuestionAction`.

#### `add-comment-form.tsx` — Formulario de comentarios (client component)

- Estado local con `useState` para contenido, envío y error.
- Textarea de 3 filas con placeholder "Escribe un comentario...".
- Botón "Comentar" deshabilitado si contenido vacío o en envío.
- Tras éxito: limpia el textarea y llama a `router.refresh()`.

### 5. Navegación

Se añadió el enlace "Preguntas" con icono `MessageSquare` en `nav-links.ts` entre "Noticias" y "Mi perfil":

```typescript
{ href: "/questions", label: "Preguntas", icon: MessageSquare },
```

Este enlace es visible para todos los roles autenticados (sin `showFor`) y se renderiza tanto en el sidebar como en el bottom-nav (ambos consumen `nav-links.ts`).

### 6. Tests

24 tests unitarios para Zod schemas (mismo patrón que los tests del módulo de Noticias), todos pasando:

| Suite | Tests | Cobertura |
|-------|-------|-----------|
| `questionFormSchema` | 11 | Acepta payload válido; rechaza título vacío; rechaza título > 200 chars; rechaza contenido vacío; rechaza contenido > 5000 chars; defaults category a "general"; defaults priority a "media"; rechaza categoría inválida; rechaza prioridad inválida; acepta categoría explícita "musica"; acepta prioridad explícita "alta" |
| `createQuestionSchema` | 1 | Acepta mismo payload que questionFormSchema |
| `updateQuestionSchema` | 2 | Rechaza UUID inválido; acepta UUID válido |
| `deleteQuestionSchema` | 2 | Rechaza id vacío; acepta UUID válido |
| `resolveQuestionSchema` | 4 | Rechaza UUID inválido; rechaza `resolved` no booleano; acepta `resolved=true`; acepta `resolved=false` |
| `addCommentSchema` | 4 | Rechaza `question_id` UUID inválido; rechaza contenido vacío; rechaza contenido > 2000 chars; acepta input válido |

### 7. Seguridad

#### Autorización (capa de aplicación)

- **Creación de preguntas y comentarios**: cualquier usuario autenticado — `requireAuthenticatedProfile()`.
- **Modificación (update, delete, resolve)**: solo el creador o management — `assertCanModifyQuestion()`.
- Las páginas redirigen a `/auth/login` si el usuario no está autenticado.

#### RLS (defensa en profundidad)

| Operación | Capa aplicación | RLS |
|-----------|----------------|-----|
| SELECT questions | Sin filtro (todos auth) | `auth.role() = 'authenticated'` |
| INSERT questions | `requireAuthenticatedProfile()` | `auth.role() = 'authenticated'` |
| UPDATE questions | `assertCanModifyQuestion()` | `auth.uid() = user_id` OR management |
| DELETE questions | `assertCanModifyQuestion()` | `auth.uid() = user_id` OR management |
| SELECT comments | Sin filtro (todos auth) | `auth.role() = 'authenticated'` |
| INSERT comments | `requireAuthenticatedProfile()` | `auth.role() = 'authenticated'` |
| UPDATE comments | Sin mutación (no implementado) | `auth.uid() = user_id` |
| DELETE comments | Sin mutación (no implementado) | `auth.uid() = user_id` OR management |

#### Seguridad de datos

- No se almacenan contraseñas, secrets ni tokens en el módulo.
- No hay vectores de inyección SQL (todas las consultas usan el query builder de Supabase).
- Security scan: PASS — 0 HIGH, 0 MEDIUM, 2 LOW (opcional: mejoras de logging y rate limiting diferidas).

---

## Arquitectura

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Frontend (Server Components + Client Components)                             │
│                                                                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────────┐   │
│  │ /questions       │  │ /questions/[id]  │  │ /questions/new (create)   │   │
│  │ Server component │  │ Server component │  │ ┌───────────────────────┐ │   │
│  │ Tarjetas +       │  │ Artículo +       │  │ │ QuestionForm          │ │   │
│  │ Filtros URL      │  │ Comentarios +    │  │ │ (React Hook Form     │ │   │
│  │ Botón "Nueva"    │  │ Acciones (creador│  │ │  + Zod resolver)      │ │   │
│  └────────┬─────────┘  │  o management)   │  │ └───────────────────────┘ │   │
│           │            └────────┬─────────┘  └───────────────────────────┘   │
│           │                     │                                             │
└───────────┼─────────────────────┼────────────────────────────────────────────┘
            │                     │
┌───────────▼─────────────────────▼────────────────────────────────────────────┐
│  Server Actions (src/app/questions/actions.ts)                                 │
│  createQuestionAction / updateQuestionAction / deleteQuestionAction            │
│  resolveQuestionAction / addCommentAction                                     │
│  (revalidatePath on success)                                                  │
└───────────┬───────────────────────────────────────────────────────────────────┘
            │
┌───────────▼───────────────────────────────────────────────────────────────────┐
│  Application Layer (src/lib/questions/)                                        │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────────────┐   │
│  │ schema.ts       │  │ queries.ts       │  │ mutations.ts              │   │
│  │ (Zod schemas)   │  │ getQuestions     │  │ createQuestion            │   │
│  │ questionForm/   │  │ getQuestionById  │  │ updateQuestion            │   │
│  │ create/update/  │  │ getQuestion-     │  │ deleteQuestion            │   │
│  │ delete/resolve/ │  │ Comments         │  │ resolveQuestion           │   │
│  │ addComment      │  │                  │  │ addComment                │   │
│  └─────────────────┘  └────────┬─────────┘  │ (gate: requireAuth /     │   │
│                                │            │  assertCanModifyQuestion) │   │
│                                │            └───────────┬───────────────┘   │
└────────────────────────────────┼────────────────────────┼───────────────────┘
                                 │                        │
┌────────────────────────────────▼────────────────────────▼───────────────────┐
│  Supabase (RLS enforced)                                                     │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │ umsuka.questions                                                       │   │
│  │ category, priority, resolved, user_id, created_at                      │   │
│  │ Políticas:                                                             │   │
│  │ SELECT/INSERT: any authenticated                                       │   │
│  │ UPDATE/DELETE: creator OR management                                   │   │
│  │ Índices: idx_questions_category, idx_questions_priority,               │   │
│  │           idx_questions_user_id, idx_questions_resolved                 │   │
│  ├───────────────────────────────────────────────────────────────────────┤   │
│  │ umsuka.question_comments                                               │   │
│  │ question_id (FK cascade), user_id, content, created_at                 │   │
│  │ Políticas:                                                             │   │
│  │ SELECT/INSERT: any authenticated                                       │   │
│  │ UPDATE: comment creator                                                │   │
│  │ DELETE: comment creator OR management                                  │   │
│  │ Índices: idx_question_comments_question_id                             │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Flujo de creación de pregunta

```
┌────────────┐     ┌──────────────┐     ┌──────────────┐     ┌───────────────┐
│ QuestionForm│     │createQuestion│     │createQuestion│     │ Supabase      │
│ (cliente)  │     │ Action       │     │ (mutations)  │     │ (RLS + data)  │
├────────────┤     ├──────────────┤     ├──────────────┤     ├───────────────┤
│ 1. User    │────>│ 2. recibe    │────>│ 3. Zod parse │────>│ 4. INSERT     │
│    llena   │     │    input     │     │    + auth    │     │    question   │
│    form    │     │              │     │    + insert  │     │    row        │
│ 6. router  │<────│ 5. return    │<────│ 4. return id │<────│ 5. row id     │
│    push()  │     │    success   │     │              │     │               │
│    +       │     │              │     │              │     │               │
│ 7. refresh │     │              │     │              │     │               │
│    /quest- │     │              │     │              │     │               │
│    ions/[id]│     │              │     │              │     │               │
└────────────┘     └──────────────┘     └──────────────┘     └───────────────┘
```

---

## Decisiones arquitectónicas clave

| # | Decisión | Alternativa considerada | Razón |
|---|----------|------------------------|-------|
| 1 | **Seguir el mismo patrón que News (3 capas + server actions)** | Patrón diferente por ser un módulo distinto | Consistencia arquitectónica; reutilización de patrones ya probados en Sprint 10. Reduce curva de aprendizaje y facilita mantenimiento. |
| 2 | **Cualquier auth puede crear preguntas y comentar** | Solo management puede crear | Fomenta participación comunitaria; todas las preguntas son visibles para todos. Management retiene control sobre resolución y eliminación. |
| 3 | **Creador puede resolver sus preguntas** | Solo management resuelve | El creador sabe cuándo su duda está resuelta; reduce carga de management para preguntas simples. |
| 4 | **URL search params para filtros** | Estado React (useState/useReducer) | Filtros compartibles y bookmarkeables; consistente con patrón de server components; evita estado cliente para filtros. |
| 5 | **Sin edición de preguntas** | Página de edición como en News | MVP scope; las preguntas pueden actualizarse via updateQuestion desde el panel de acciones si es necesario en el futuro. Se difiere a sprint futuro. |
| 6 | **Sin paginación** | Paginación cursor/offset | MVP scope; volumen esperado bajo. La paginación puede añadirse después sin cambios breaking. |
| 7 | **`assertCanModifyQuestion()` con doble verificación** | Solo RLS | Defensa en profundidad: la capa de aplicación replica la lógica de RLS para dar mensajes de error específicos antes de llegar a BD. |
| 8 | **`fetchProfileNames()` helper reutilizable** | JOIN directo en cada query | Misma optimización que en News y Shifts: evita N+1 mediante consultas IN + Map. |

---

## Edge cases manejados

### Validación de schemas (24 tests)

| Escenario | Comportamiento |
|-----------|----------------|
| Título vacío | Rechazado: "El título es obligatorio." |
| Título > 200 caracteres | Rechazado |
| Contenido vacío | Rechazado: "La descripción es obligatoria." |
| Contenido > 5000 caracteres | Rechazado |
| Categoría no proporcionada | Default `"general"` |
| Prioridad no proporcionada | Default `"media"` |
| Categoría inválida | Rechazado: "Selecciona una categoría válida." |
| Prioridad inválida | Rechazado: "Selecciona una prioridad válida." |
| `id` UUID inválido en update/delete/resolve | Rechazado |
| `resolved` no booleano en resolve | Rechazado |
| `question_id` UUID inválido en addComment | Rechazado |
| Comentario vacío | Rechazado: "El comentario no puede estar vacío." |
| Comentario > 2000 caracteres | Rechazado |

### Seguridad y autorización

| Escenario | Comportamiento |
|-----------|----------------|
| Usuario no autenticado visita `/questions` | Redirigido a `/auth/login` |
| Usuario no autenticado visita `/questions/new` | Redirigido a `/auth/login` |
| Usuario no autenticado visita `/questions/[id]` | Redirigido a `/auth/login` |
| Miembro regular intenta eliminar pregunta ajena | Error: "No tienes permisos para modificar esta pregunta." |
| Miembro regular intenta resolver pregunta ajena | Error: "No tienes permisos para modificar esta pregunta." |
| Creador resuelve su propia pregunta | Permitido |
| Management resuelve pregunta de otro | Permitido |
| Management elimina pregunta de otro | Permitido |

### Queries

| Escenario | Comportamiento |
|-----------|----------------|
| Lista sin preguntas | Array vacío → mensaje "No hay preguntas... todavía" |
| Pregunta no encontrada por ID | `getQuestionById` retorna `null` → 404 |
| Error de base de datos | Error propagado con mensaje en español |
| Pregunta sin perfil de autor | `authorFirstName` = "Miembro", `lastName` = "" |
| Comentario sin perfil de autor | `authorFirstName` = "Miembro", `lastName` = "" |

---

## Consecuencias

### Positivas

- Sistema completo de preguntas y discusión comunitaria con creación, categorización, priorización y resolución.
- Cualquier miembro autenticado puede participar activamente (crear preguntas y comentar).
- Filtros URL-based compartibles y bookmarkeables (estado, categoría, solo mis preguntas).
- Defensa en profundidad: validación Zod + autorización en servidor + RLS.
- Consultas optimizadas con fetch de perfiles agrupado (evita N+1).
- Panel de acciones contextual visible solo para quien tiene permisos (creador o management).
- 24 nuevos tests (0 regresiones).
- Sin hallazgos HIGH ni MEDIUM en security scan.
- Consistencia arquitectónica total con el módulo de Noticias (Sprint 10).
- Reutilización del helper `fetchProfileNames()` para resolver nombres de autor en listas y detalle.

### Negativas / Riesgos

- **Sin edición de preguntas**: si un miembro quiere corregir o ampliar su pregunta, no puede hacerlo sin crear una nueva. Se debe añadir página de edición en sprint futuro.
- **Sin paginación**: a medida que crezca el número de preguntas, la lista completa podría volverse lenta. Se debe implementar paginación (cursor o infinite scroll) en sprint futuro.
- **Sin notificaciones**: cuando alguien comenta una pregunta, no se envía ninguna notificación al creador ni a otros comentaristas. Deben entrar manualmente a la app para ver nuevas respuestas.
- **Sin borrado lógico (soft delete)**: `deleteQuestion` elimina físicamente la fila y sus comentarios (por cascade). No hay papelera de reciclaje ni restauración.
- **Sin ordenamiento por prioridad**: las preguntas se ordenan solo por `created_at DESC`. Las preguntas de alta prioridad no aparecen destacadas. Se podría implementar un feed similar al pinned de noticias.

### Técnicas

- Se migró la tabla `umsuka.questions` con `ADD COLUMN` (sin `IF NOT EXISTS` ya que las columnas no existían previamente en producción).
- Se creó la nueva tabla `umsuka.question_comments` con FK → `umsuka.questions(id) ON DELETE CASCADE` para que al eliminar una pregunta se eliminen automáticamente sus comentarios.
- Se habilitó RLS en ambas tablas con políticas granulares.
- Se crearon índices en `category`, `priority` y `question_id` para optimizar consultas de filtrado y joins.
- Se actualizó `src/types/database.types.ts` con los nuevos campos en `questions` (`category`, `priority`) y la nueva tabla `question_comments`.
- La navegación (sidebar y bottom-nav) actualiza automáticamente el enlace "Preguntas" sin necesidad de cambios adicionales, gracias a que ambas consumen `nav-links.ts`.

---

## Archivos Modificados/Creados

| Archivo | Acción |
|---------|--------|
| `supabase/migrations/20260101003900_questions_rls_enhancement.sql` | CREATE |
| `src/lib/questions/schema.ts` | CREATE |
| `src/lib/questions/queries.ts` | CREATE |
| `src/lib/questions/mutations.ts` | CREATE |
| `src/lib/questions/__tests__/schema.test.ts` | CREATE |
| `src/app/questions/actions.ts` | CREATE |
| `src/app/questions/page.tsx` | CREATE |
| `src/app/questions/new/page.tsx` | CREATE |
| `src/app/questions/new/question-form.tsx` | CREATE |
| `src/app/questions/[id]/page.tsx` | CREATE |
| `src/app/questions/[id]/add-comment-form.tsx` | CREATE |
| `src/app/questions/[id]/resolve-button.tsx` | CREATE |
| `src/app/questions/[id]/delete-question-button.tsx` | CREATE |
| `src/types/database.types.ts` | MODIFY — added `category`, `priority` to `questions` Row/Insert/Update; added `question_comments` table type |
| `src/components/layout/nav-links.ts` | MODIFY — added `MessageSquare` icon and `Preguntas` nav link |
