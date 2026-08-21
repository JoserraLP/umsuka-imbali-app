# ADR-024: Sprint 24 — Gestión de Instrumentos (Instrument Management)

**Status:** Accepted (Implementado) · **Date:** 2026-08-21 · **Sprint:** 24 ·
**Branch:** `feature/sprint-24-instrument-management`

---

## Context

La comparsa necesitaba gestionar el **inventario de instrumentos** (alta, edición y baja de
instrumentos con nombre, categoría, descripción y estado) y asignar **una persona responsable
por instrumento**, conservando el historial de responsables. Hasta este sprint no existía
ningún módulo de inventario: ni tablas en el esquema `umsuka`, ni capa de aplicación, ni rutas
`/instruments`, ni entrada en la navegación.

El proyecto modela la «directiva» con el conjunto **`MANAGEMENT_ROLES`**
(`super_admin`, `admin`, `board_member`, `event_manager` — `src/lib/auth/roles.ts`), espejado
en base de datos por el helper **`umsuka.is_management()`** (migración 0013). Siguiendo el
modelo de transparencia asociativa del esquema base (0013), **todo usuario autenticado puede
leer** el inventario y el historial, mientras que **solo la directiva puede escribir**.

Requisitos (criterios de aceptación del task file):

- La directiva y el `super_admin` gestionan instrumentos: alta, edición y **baja lógica**
  (`is_active`), nunca borrado físico desde la app.
- Cada instrumento tiene **como máximo una persona responsable activa a la vez**; al asignar
  un nuevo responsable, la asignación anterior se cierra automáticamente.
- El **historial de responsables** de cada instrumento queda registrado (`assigned_at` /
  `unassigned_at`) y es visible para todos los autenticados.
- Los instrumentos inactivos **no aparecen en los listados de asignación** y no pueden
  recibir nuevas asignaciones.
- Todos los autenticados leen el inventario; solo la directiva modifica (**RLS + validación
  de rol en la capa de negocio**, doble barrera).

### Estado previo

- **Cero inventario**: no existían `umsuka.instruments` ni `umsuka.instrument_assignments`;
  la última migración era la 0055 (`fix_events_rls_recursion`), quedando la 0056 como
  siguiente numeración disponible.
- Patrones del repo reutilizados tal cual:
  - `requireManagementGuard` + `MutationResult` (`src/lib/votings/mutations.ts`, Sprint 15)
    para el guard de rol en mutations.
  - Merges en JS con una query extra por aspecto (patrón `getEventComments`, Sprint 17) para
    resolver relaciones **sin N+1**.
  - Criterio de miembro activo de `getAvailableMembers` (`shifts/queries.ts`):
    `is_active = true`, `status = 'active'`, `deleted_at IS NULL`.
  - Índice único case-insensitive (patrón 0049 de `voting_options`) para nombres de
    instrumento.
  - Trigger `umsuka.update_updated_at_column()` (0018) para `updated_at`.
- `src/types/database.types.ts` sin tipos de instrumentos; `nav-links.ts` sin entrada
  «Instrumentos».

---

## Decisión

### D1 — Migración `20260101005600_instruments.sql`: dos tablas con baja lógica e historial inmutable

**`umsuka.instruments`** — inventario:

| Columna | Tipo / restricción |
|---|---|
| `id` | `uuid` PK `default gen_random_uuid()` |
| `name` | `text NOT NULL`, CHECK `char_length <= 200` y `length(trim(name)) > 0` |
| `category` | `text` nullable, CHECK `<= 100` caracteres |
| `description` | `text` nullable, CHECK `<= 2000` caracteres |
| `is_active` | `boolean NOT NULL DEFAULT true` — **baja lógica**: `false` = desactivado (no asignable, oculto de listados de asignación) |
| `created_at` / `updated_at` | `timestamptz DEFAULT now()` |

- Índice único **case-insensitive** `idx_instruments_name_lower_unique` sobre `(lower(name))`
  (espejo del patrón 0049): «TAMBOR» y «tambor» colisionan a nivel de BD; origen del mapeo
  23505 en `createInstrument`/`updateInstrument`.
- Trigger `trg_instruments_updated_at` (`BEFORE UPDATE`) reutilizando
  `umsuka.update_updated_at_column()` (0018) verbatim, con `drop trigger if exists`
  (re-ejecución segura del trigger).

**`umsuka.instrument_assignments`** — historial de responsables:

| Columna | Tipo / restricción |
|---|---|
| `id` | `uuid` PK `default gen_random_uuid()` |
| `instrument_id` | `uuid NOT NULL` FK → `instruments` `ON DELETE CASCADE` |
| `user_id` | `uuid NOT NULL` FK → `profiles` `ON DELETE CASCADE` |
| `assigned_at` | `timestamptz NOT NULL DEFAULT now()` |
| `unassigned_at` | `timestamptz` nullable — `NULL` mientras la asignación está **activa**; fecha de cierre al reemplazar/desasignar |

- CHECK `instrument_assignments_unassigned_not_before_assigned`:
  `unassigned_at IS NULL OR unassigned_at >= assigned_at`.
- Índices de lectura: `(instrument_id, assigned_at desc)` para el historial del detalle y
  `(user_id)` para consultas por miembro.
- **Sin política DELETE** (D4): las filas de historial son inmutables por diseño; una
  asignación solo se **cierra** (`unassigned_at = now()`), nunca se borra.

La migración incluye comentarios de tabla/columna y un **checklist manual pre-deploy** (sin
Supabase local/CLI en el entorno; SQL hand-reasoned, patrón de sprints previos).

### D2 — «Una persona responsable a la vez»: partial unique index como garantía final en BD

La asignación activa de un instrumento es **la fila con `unassigned_at IS NULL`**. La
invariante «como máximo una activa por instrumento» se garantiza en base de datos con un
**índice único parcial**:

```sql
create unique index idx_instrument_assignments_active_instrument
    on umsuka.instrument_assignments (instrument_id)
    where unassigned_at is null;
```

- Cualquier número de filas **cerradas** es válido (historial ilimitado); un segundo insert
  activo para el mismo instrumento falla con **23505** aunque el cliente ataque la API
  directamente saltándose la capa de aplicación.
- Es la **defensa de fondo** del flujo de asignación no transaccional de D3: la capa de app
  ordena las operaciones para minimizar la ventana, pero es el índice quien hace imposible el
  estado inválido.

### D3 — Flujo `assignInstrument`: pre-check → cierre → inserción, con mapeo 23505/23503

`assignInstrument` (`src/lib/instruments/mutations.ts`) ejecuta, en este orden:

1. Parse Zod (`assignSchema`) + `requireManagementGuard`.
2. **Pre-check del instrumento**: existe («Instrumento no encontrado.») y está activo
   («No se puede asignar un instrumento inactivo.»).
3. **Pre-check del miembro ANTES de cerrar la asignación previa** (mismos criterios que
   `getAssignableMembers`: existe, `is_active`, `status = 'active'`, `deleted_at IS NULL`);
   si falla → «El miembro seleccionado ya no está disponible.». Este orden es deliberado: un
   submit obsoleto (miembro eliminado entre render y submit) aborta **antes** de cualquier
   escritura, de modo que el instrumento nunca queda sin su responsable anterior por culpa de
   un dato stale.
4. **Cierre de la asignación activa previa**: `UPDATE … SET unassigned_at = now() WHERE
   instrument_id = X AND unassigned_at IS NULL`.
5. **INSERT de la nueva asignación**, con mapeo de errores:
   - **23505** (doble asignación por carrera: otro directivo cerró+insertó primero) →
     «El instrumento ya tiene una persona responsable asignada.»
   - **23503** (el miembro desapareció tras el pre-check, TOCTOU) → el mismo mensaje
     amigable de miembro no disponible, nunca el error crudo de FK.

`unassignInstrument` cierra la asignación activa con el mismo predicado
(`unassigned_at IS NULL`) y `.select("id").maybeSingle()`: si no hay fila activa →
«El instrumento no tiene una persona responsable asignada.». La fila histórica jamás se
borra.

### D4 — RLS: lectura universal autenticada, escritura solo `is_management()`, sin DELETE en assignments

Ambas tablas con `ENABLE` + **`FORCE ROW LEVEL SECURITY`**. Matriz de políticas:

| Tabla | Política | Operación | Regla |
|---|---|---|---|
| `instruments` | `instruments_select_authenticated` | SELECT | `to authenticated using (true)` |
| `instruments` | `instruments_write_management` | **FOR ALL** (INSERT/UPDATE/DELETE) | `to authenticated using / with check umsuka.is_management()` |
| `instrument_assignments` | `instrument_assignments_select_authenticated` | SELECT | `to authenticated using (true)` |
| `instrument_assignments` | `instrument_assignments_insert_management` | INSERT | `with check umsuka.is_management()` |
| `instrument_assignments` | `instrument_assignments_update_management` | UPDATE | `using / with check umsuka.is_management()` |
| `instrument_assignments` | — | **DELETE** | **Sin política: omitida deliberadamente.** Ningún rol puede borrar historial vía API |

- Se **reutiliza el helper preexistente `umsuka.is_management()`** (0013: `language sql`,
  `stable`, `security definer`, `set search_path = umsuka, public`, `grant execute` a
  `authenticated`), cuyo conjunto de roles (`super_admin`, `admin`, `board_member`,
  `event_manager`) es **idéntico** a `MANAGEMENT_ROLES` de `src/lib/auth/roles.ts`. **No se
  crea `is_directiva()`**: sería un duplicado con riesgo de divergencia (ver Alternativas).
- La RLS (BD) y el guard de aplicación (`requireManagementGuard` en las **5 mutations**,
  patrón votings) forman la **doble barrera de autorización**: un cliente que llame a
  PostgREST directamente queda limitado por las políticas; un flujo legítimo de app valida
  rol antes de tocar la BD con mensajes consistentes.

### D5 — Capa `src/lib/instruments/`: Zod isomórfico, queries sin N+1, mutations con guards

- **`schema.ts`** — schemas Zod con mensajes en español, compartibles cliente/servidor:
  - `createInstrumentSchema`: `name` requerido (trim, 1–200), `category` opcional (≤100) y
    `description` opcional (≤2000) mediante el helper `optionalTrimmedText`, que trimea y
    **normaliza vacío a `null`** (patrón de normalización del módulo events).
  - `updateInstrumentSchema` = create + `id` UUID; `assignSchema` (`instrument_id` +
    `user_id` UUID), `unassignSchema` y `toggleInstrumentActiveSchema` (UUID).
- **`queries.ts`** (cliente anónimo de servidor, nunca elevado):
  - `getInstruments({ includeInactive })` — inventario ordenado por nombre; por defecto solo
    activos; los listados de management pasan `includeInactive: true`.
  - `resolveActiveAssignees` — resuelve el responsable activo de N instrumentos con **dos
    queries batched** (asignaciones con `unassigned_at IS NULL` + perfiles por `in(...)`)
    devolviendo un `Map instrumentId → assignee`; usado por listado y detalle (**sin N+1**,
    patrón `getEventComments`).
  - `getInstrumentById(id)` — detalle + responsable actual (`maybeSingle`).
  - `getAssignments(instrumentId)` — historial completo, más reciente primero, enriquecido
    con `first_name`/`last_name` del perfil (merge en JS, una sola query extra de perfiles).
  - `getAssignableMembers()` — selector de responsables: `is_active = true`,
    `status = 'active'`, `deleted_at IS NULL`, ordenado por nombre (patrón
    `getAvailableMembers` de shifts). **Coherencia garantizada** con el pre-check de D3:
    ambos usan el mismo criterio.
- **`mutations.ts`** — patrón `lib/votings/`: `MutationResult { success, error?, id? }`,
  `requireManagementGuard(errorMessage)` (devuelve el perfil autenticado o un resultado de
  error, sin escribir en BD), constantes `UNIQUE_VIOLATION = "23505"` /
  `FOREIGN_KEY_VIOLATION = "23503"` y todas las mutations con parse Zod **antes** de tocar la
  BD: `createInstrument`, `updateInstrument` (con pre-check de existencia),
  `toggleInstrumentActive` (lee `is_active` y lo invierte), `assignInstrument` (D3) y
  `unassignInstrument`.

### D6 — Server actions thin con `revalidatePath`

`src/app/instruments/actions.ts`: `createInstrumentAction`, `updateInstrumentAction`,
`toggleInstrumentActiveAction`, `assignInstrumentAction`, `unassignInstrumentAction` —
wrappers thin que delegan en las mutations, retornan `MutationResult` y, **solo en éxito**,
hacen `revalidatePath("/instruments")` y `revalidatePath("/instruments/[id]")` (donde aplica
según la acción). Sin lógica propia: toda la autorización y validación vive en la capa
`src/lib/instruments/`.

### D7 — UI `/instruments` y `/instruments/[id]`: gestión para la directiva, historial para todos

- **`/instruments`** (`page.tsx`, server component): guarda de login (redirect a
  `/auth/login`); `canManage = isManagementRole(profile.role)`; listado en grid de tarjetas
  enlazadas al detalle (badges Activo/Inactivo + categoría, responsable actual o «Sin
  responsable asignado»); sección «Nuevo instrumento» y `includeInactive` **solo para
  management**; estados vacíos diferenciados por rol.
- **`/instruments/[id]`** (`[id]/page.tsx`): `generateMetadata` con el nombre del
  instrumento; `notFound()` si no existe; ficha (badges, nombre, responsable actual,
  descripción con `whitespace-pre-line`); bloque **Gestión** solo para management (form de
  edición con valores precargados, botón Desactivar/Activar con texto explicativo del efecto,
  y `AssignResponsableForm`); sección **Historial de responsables visible para todos los
  autenticados**: filas con nombre del responsable, «Desde {fecha}» / «hasta {fecha}»
  (`Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short" })`) y badge
  **«Actual»** en la fila con `unassigned_at` nulo.
- Componentes cliente: `instrument-form.tsx` (create/edit, trim en cliente, `maxLength` en
  inputs, tras crear navega al detalle), `toggle-active-button.tsx` (Archive/RotateCcw) y
  `assign-responsable-form.tsx` (select de miembros asignables precargado con el responsable
  actual, botón «Desasignar responsable» solo cuando hay responsable, **form oculto por
  completo si el instrumento está inactivo**, errores con `role="alert"` y `router.refresh()`
  al éxito).

### D8 — Entrada «Instrumentos» en la navegación, visible para todos los autenticados

`src/components/layout/nav-links.ts`: `{ href: "/instruments", label: "Instrumentos",
icon: Music }` colocada entre «Votaciones» y «Mi perfil», **sin `showFor`** → visible para
todos los roles autenticados (la lectura es universal; los controles de gestión se ocultan en
la página, no en el nav). Los tests de `bottom-nav` se ajustaron al nuevo recuento: **16
secciones para `super_admin`** (antes 15) y **10 para `member`** (antes 9).

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| RPC `SECURITY DEFINER` transaccional para el assign atómico (close+insert en una transacción) | El repo no usa transacciones vía PostgREST (las RPCs existentes son de solo lectura o puntuales); la ventana entre cierre e inserción es mínima y el **partial unique index (D2)** convierte cualquier carrera en un 23505 mapeado a mensaje amigable. Un RPC nuevo añadiría superficie `SECURITY DEFINER` sin eliminar ningún riesgo real. |
| Helper SQL nuevo `is_directiva()` (previsto en el plan) | `umsuka.is_management()` (0013) ya existe con **exactamente el mismo conjunto de roles** (`super_admin`, `admin`, `board_member`, `event_manager`) que `MANAGEMENT_ROLES`; crear otro helper duplicaría la definición de «directiva» y arriesgaría divergencia futura entre BD y app. |
| Borrado físico de asignaciones al reasignar (DELETE + INSERT) | Destruiría el historial de responsables, requisito central del sprint. Se eligió **soft-close** (`unassigned_at`): la fila cerrada queda como registro histórico inmutable. |
| Política DELETE en `instrument_assignments` | **Omitida deliberadamente**: sin política, ningún rol (ni siquiera management) puede borrar historial vía API; los únicos deletes posibles son los `ON DELETE CASCADE` desde `instruments`/`profiles`, ejecutados por `service_role` o helpers `SECURITY DEFINER` como en el resto del esquema. |
| Columna denormalizada «responsable actual» en `instruments` | Requeriría sincronizar dos fuentes de verdad en cada assign/unassign; el partial unique index sobre la propia tabla de asignaciones **expresa la regla directamente** y el responsable actual se resuelve con una query batched barata (D5). |

---

## Edge cases manejados

| Escenario | Comportamiento |
|---|---|
| Submit obsoleto: el miembro se elimina entre render y submit | El pre-check de miembro corre **antes** de cerrar la asignación previa → «El miembro seleccionado ya no está disponible.» sin dejar el instrumento sin responsable (D3) |
| Dos directivos asignan a la vez (carrera) | El segundo INSERT viola el partial unique index → 23505 → «El instrumento ya tiene una persona responsable asignada.» (D2/D3) |
| El miembro desaparece justo después del pre-check (TOCTOU) | INSERT falla con 23503 → mismo mensaje amigable, nunca el error crudo de FK (commit `92df011`) |
| Asignar sobre un instrumento inactivo | Mutation lo rechaza («No se puede asignar un instrumento inactivo.») y la UI oculta el formulario completo (`instrumentActive: false` → `return null`) |
| Desasignar un instrumento sin responsable | El `UPDATE` con `unassigned_at IS NULL` no matchea filas → «El instrumento no tiene una persona responsable asignada.» |
| Nombre duplicado con distinta capitalización («Tambor» / «TAMBOR») | Índice único `lower(name)` → 23505 → «Ya existe un instrumento con ese nombre.» en create y update |
| Campos opcionales vacíos o solo espacios | El form trimea en cliente y `optionalTrimmedText` normaliza `""` → `null` antes de persistir |
| `unassigned_at` anterior a `assigned_at` | Imposible: CHECK `instrument_assignments_unassigned_not_before_assigned` |
| Reasignar a la misma persona | Cierra la fila activa y abre una nueva (`assigned_at` se reinicia); el historial conserva ambas filas |
| Perfil del responsable eliminado (hard delete vía service role) | El merge defensivo muestra «Miembro» como nombre; la fila de historial persiste (FK cascade solo si se borra el perfil) |
| Re-ejecución del trigger de `updated_at` | `drop trigger if exists` previo: re-ejecución segura (checklist manual de la migración) |
| Instrumento inactivo con responsable activo | La asignación **no** se cierra: el badge «Actual» permanece en el historial (decisión de diseño, ver Consecuencias) |

---

## Consecuencias

### Positivas

- **Inventario completo con baja lógica**: alta, edición y activar/desactivar sin borrados
  físicos desde la app; los inactivos desaparecen de los listados públicos y de la
  asignación, pero conservan su historial.
- **Invariante «un responsable a la vez» garantizada en tres capas**: pre-check de miembro
  antes del cierre (evita dejar el instrumento huérfano por datos stale), orden
  close→insert, y **partial unique index** como defensa final ante carreras.
- **Historial inmutable y transparente**: sin política DELETE en `instrument_assignments`,
  visible para todos los autenticados con fechas formateadas y badge «Actual».
- **Doble barrera de autorización** (RLS `is_management()` + `requireManagementGuard` en las
  5 mutations) con el mismo conjunto de roles en BD y app.
- **Queries sin N+1**: responsable actual e historial se resuelven con merges en JS (dos
  queries batched por aspecto), patrón consolidado del repo.
- **Suite nueva verde**: 42 tests nuevos (19 de schema + 23 de mutations con el chain-builder
  mockeado al estilo `votings-mutations`, con `awaitedUpdate` para distinguir el UPDATE de
  cierre del INSERT posterior sobre la misma tabla).

### Seguridad (defensa en profundidad)

- `ENABLE` + **`FORCE` RLS** en ambas tablas: ni siquiera el propietario de la tabla omite las
  políticas.
- SELECT solo para `authenticated` (nunca `anon`); escrituras exclusivamente vía
  `umsuka.is_management()` (helper `SECURITY DEFINER` de 0013 con `search_path` fijado y
  `grant execute` solo a `authenticated`).
- **Sin política DELETE en `instrument_assignments`**: el historial no es borrable vía API
  por ningún rol.
- Mensajes de error amigables y acotados (mapeos 23505/23503); el `error.message` crudo solo
  aparece para códigos desconocidos (patrón preexistente del repo).
- Security scan del pipeline (security-champion): **CLEAN — 0 HIGH** (estado
  `security-cleared` del task file).

### Trade-offs aceptados / hallazgos conocidos

1. **Ventana no transaccional entre el cierre y el insert** (D3): mitigada por el orden
   pre-check → close → insert y por el partial unique index. Si el insert falla tras el
   cierre (p. ej. carrera 23505), el instrumento queda **temporalmente sin responsable
   activo** y la fila cerrada permanece en el historial; el error se surfacea y el directivo
   puede reintentar. Aceptado: el estado inválido (dos activos) es imposible y el estado
   intermedio (cero activos) es visible y recuperable.
2. **Desactivar un instrumento NO cierra su asignación activa** — decisión de diseño:
   `toggleInstrumentActive` solo invierte `is_active`. El badge «Actual» permanece visible en
   el historial y el responsable sigue resolviéndose en las queries; lo que cambia es que el
   instrumento inactivo no puede recibir **nuevas** asignaciones (la mutation lo bloquea y la
   UI oculta el form). Documentado como comportamiento esperado, no como bug.
3. **La política `FOR ALL` de `instruments` incluye DELETE**, alcanzable solo fuera de la app
   (nota informativa del security scan): ninguna action ni componente invoca delete; un
   DELETE directo vía PostgREST por un rol de gestión cascadaría las filas de
   `instrument_assignments` del instrumento (perdiendo ese historial). Se acepta porque exige
   rol de gestión y la app nunca lo ejercita.
4. **Fallback `error.message` crudo** para códigos de error no mapeados: patrón consistente
   del repo (LOW).
5. **SQL hand-reasoned**: sin Supabase local/CLI en el entorno; la migración incluye
   checklist manual pre-deploy (patrón de sprints previos) para verificar en deploy índices,
   trigger, RLS y cascades.
6. **Documentación de BD pendiente** (deuda preexistente, no introducida por este sprint):
   la tabla de migraciones de `docs/DATABASE.md` quedó en la 0049 desde el Sprint 15 (las
   migraciones 0050–0055 de sprints anteriores tampoco constan); la 0056 deberá añadirse en
   una ronda de docs-sync junto con esas entradas.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101005600_instruments.sql` | CREATE — tablas `umsuka.instruments` + `umsuka.instrument_assignments` (CHECKs, comentarios), índices (`idx_instruments_name_lower_unique` case-insensitive, partial unique `idx_instrument_assignments_active_instrument`, índices de historial), trigger `updated_at` (0018), RLS enable+force con 5 políticas (sin DELETE en assignments) y checklist manual pre-deploy |
| `src/types/database.types.ts` | MODIFY — tipos Row/Insert/Update de `instruments` e `instrument_assignments` |
| `src/lib/instruments/schema.ts` | CREATE — `createInstrumentSchema`, `updateInstrumentSchema`, `assignSchema`, `unassignSchema`, `toggleInstrumentActiveSchema` (Zod, trim, límites 200/100/2000, normalización vacío→null) |
| `src/lib/instruments/queries.ts` | CREATE — `getInstruments({ includeInactive })`, `getInstrumentById`, `getAssignments`, `getAssignableMembers` + helper `resolveActiveAssignees` (merges en JS, sin N+1) |
| `src/lib/instruments/mutations.ts` | CREATE — `createInstrument`, `updateInstrument`, `toggleInstrumentActive`, `assignInstrument` (pre-check → close → insert; mapeo 23505/23503), `unassignInstrument`; `MutationResult` + `requireManagementGuard` (patrón votings) |
| `src/app/instruments/actions.ts` | CREATE — 5 server actions thin con `revalidatePath("/instruments")` + detalle en éxito |
| `src/app/instruments/page.tsx` | CREATE — listado en grid con badges y responsable actual, alta solo management, `includeInactive` según rol, estados vacíos diferenciados |
| `src/app/instruments/[id]/page.tsx` | CREATE — ficha, bloque Gestión (management) e historial de responsables visible para todos (fechas `es-ES`, badge «Actual») |
| `src/app/instruments/instrument-form.tsx` | CREATE — form create/edit (trim, `maxLength`, navegación al detalle tras crear) |
| `src/app/instruments/toggle-active-button.tsx` | CREATE — Desactivar/Activar con iconos y manejo de error |
| `src/app/instruments/assign-responsable-form.tsx` | CREATE — select de miembros asignables + Asignar/Desasignar; oculto si el instrumento está inactivo |
| `src/components/layout/nav-links.ts` | MODIFY — entrada «Instrumentos» (icono `Music`) sin `showFor`: visible para todos los autenticados |
| `tests/unit/lib/instruments-schema.test.ts` | CREATE — 19 tests de validación de esquema |
| `tests/unit/lib/instruments-mutations.test.ts` | CREATE — 23 tests de mutations (chain-builder estilo `votings-mutations`, `awaitedUpdate` para separar close-UPDATE de INSERT) |
| `tests/unit/components/bottom-nav.test.tsx` | MODIFY — recuentos de secciones actualizados: 16 para `super_admin`, 10 para `member` |
| `tasks/sprint-24-instrument-management.json` | CREATE — tarea del sprint |
| `docs/adr-sprint-24-instrument-management.md` | CREATE — este ADR |

### Tests

| Archivo | Tests |
|---|---|
| `tests/unit/lib/instruments-schema.test.ts` (CREATE) | 19 — límites y trim de `name`/`category`/`description`, normalización vacío→null, UUIDs válidos/inválidos en `assign`/`unassign`/`toggle` |
| `tests/unit/lib/instruments-mutations.test.ts` (CREATE) | 23 — guards de rol en las 5 mutations, 23505 → mensajes de nombre duplicado y doble asignación, 23503 → miembro no disponible, pre-check de miembro **antes** del cierre, cierre con `unassigned_at`, desasignación sin responsable, instrumento inactivo no asignable |
| `tests/unit/components/bottom-nav.test.tsx` (MODIFY) | Recuentos 15→16 (`super_admin`) y 9→10 (`member`) por la nueva entrada de nav |

**Verificado en local (2026-08-21):** `npx vitest run` → **1071 tests en 73 archivos, todos
pasando**; `npx tsc --noEmit` limpio; `npx eslint . --max-warnings=0` limpio; `npx next
build` sin errores (rutas `/instruments` y `/instruments/[id]` presentes en el manifiesto).
Security scan del pipeline: CLEAN, 0 HIGH (estado `security-cleared` del task file).

---

## Referencias

- Task file: `tasks/sprint-24-instrument-management.json` (criterios de aceptación, DoD —
  incluye este ADR como entregable; dependencias: Sprint 2 — Roles, para validar
  directiva/super_admin, y Sprint 19 — Perfiles, para el responsable asignado).
- ADR-015 (Sprint 15 — Votaciones): origen de los patrones reutilizados —
  `requireManagementGuard`/`MutationResult` en mutations, mapeo de 23505 a mensajes
  amigables, índice único case-insensitive (0049) y server actions thin con
  `revalidatePath`.
- ADR-002 (Sprint 2 — Roles): estableció el modelo de roles y el patrón de módulo en 3 capas
  (schema Zod → queries/mutations → server actions) que este sprint replica; la dependencia
  «Sprint 2 (Roles)» del task file se resuelve hoy vía `MANAGEMENT_ROLES`
  (`super_admin`, `admin`, `board_member`, `event_manager` — `src/lib/auth/roles.ts`),
  conjunto espejado por `umsuka.is_management()` (0013) usado en la RLS de este sprint.
- ADR-022 (Sprint 22 — Eliminación de Cuentas): `profiles.deleted_at` y el criterio de
  miembro activo (`deleted_at IS NULL`) que `getAssignableMembers` y el pre-check de
  `assignInstrument` respetan.
- ADR fix-events-rls-recursion (migración 0055): numeración inmediatamente previa; la 0056
  sigue su convención de cabecera y checklist manual.
- Directivas globales: `docs/git-conventions.md` (rama `feature/sprint-24-instrument-management`,
  commits semánticos `feat(sprint-24)`/`fix(sprint-24)` ya aplicados en la rama; PR y escaneo
  security-champion gestionados por el Publisher en el cierre del sprint).
