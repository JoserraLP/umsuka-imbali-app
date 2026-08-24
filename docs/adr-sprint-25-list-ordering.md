# ADR-025: Sprint 25 — Ordenación de Listados (List Ordering)

**Status:** Accepted (Implementado) · **Date:** 2026-08-24 · **Sprint:** 25 ·
**Branch:** `feature/sprint-25-list-ordering`

---

## Context

Los tres listados principales de la aplicación — **miembros** (`/members`),
**instrumentos** (`/instruments`) y **eventos** (`/events`) — se mostraban siempre con un
orden fijo impuesto por el `ORDER BY` de su query. La comparsa necesitaba poder ordenarlos
por distintos criterios y que esa elección **persistiera por usuario** entre visitas y
sesiones, sin romper los filtros existentes ni tumbar un listado si la preferencia almacenada
estaba corrupta o era inválida.

Requisitos (criterios de aceptación del task file):

- Cada listado es ordenable por **al menos 3 criterios distintos**, con control «Ordenar por»
  visible en `/members`, `/instruments` y `/events`.
- La preferencia se guarda **por usuario en la base de datos** y se re-aplica automáticamente
  al volver a cualquier listado.
- La ordenación se aplica sobre el **conjunto completo antes de paginar** (hoy no hay
  paginación; el contrato queda fijado para el futuro).
- Cada usuario solo puede **leer/escribir sus propias preferencias** (RLS + validación en la
  capa de negocio, doble barrera).
- Un criterio inválido o manipulado desde el cliente **no rompe el listado** (Zod + fallback
  al orden por defecto).

### Estado previo

- **Cero infraestructura genérica de preferencias**: la única tabla de preferencias era
  `umsuka.notification_preferences` (0052), con una columna específica `types text[]`
  acoplada a notificaciones; no existía ninguna tabla reutilizable para otros grupos de
  preferencias. La última migración era la 0058 (`rehearsal_attendance`), quedando la 0059
  como siguiente numeración disponible.
- Los tres listados obtenían sus datos vía queries ya existentes
  (`getMembersAction` + `filterMembers`, `getInstruments`, `listEvents`) con su `ORDER BY`
  fijo como única ordenación; `/members` además usa `searchParams` para filtros
  (workgroup/component/status/búsqueda).
- Patrones del repo reutilizados tal cual:
  - Tabla por usuario con PK FK `auth.users ON DELETE CASCADE` + timestamps y RLS own-row en
    4 políticas (espejo exacto de `notification_preferences`, 0052).
  - Trigger `umsuka.update_updated_at_column()` (0018) para `updated_at`.
  - Merge en JS + upsert `onConflict user_id` (patrón `updateNotificationPreferences`).
  - Server action fuera de la convención `app/**/actions.ts` compartida por varias rutas
    (precedente `src/app/events/audience-actions.ts`).
  - Checklist manual pre-deploy en la migración (sin Supabase local/CLI; SQL hand-reasoned,
    patrón de sprints previos).
- `src/types/database.types.ts` sin entrada `user_preferences` (aunque el tipo `Json` ya
  existía); sin módulo `src/lib/ordering/`; sin componente de ordenación.

---

## Decisión

### D1 — Migración `20260101005900_user_preferences.sql`: tabla genérica de preferencias con validación de sobreestructura

**`umsuka.user_preferences`** — una fila por usuario, todas las preferencias actuales y
futuras caben aquí:

| Columna | Tipo / restricción |
|---|---|
| `user_id` | `uuid` PK, FK → `auth.users(id)` `ON DELETE CASCADE` |
| `list_ordering` | `jsonb NOT NULL DEFAULT '{}'` — documento `{ <listId>: { sortBy, direction } }` |
| `created_at` / `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

- El comentario de tabla fija la política de extensión: nuevos grupos de preferencias serán
  columnas o claves jsonb nuevas, **nunca tablas nuevas por preferencia**.
- **CHECK de sobreestructura** `chk_user_preferences_list_ordering_shape` apoyado en la
  función SQL **`umsuka.is_valid_list_ordering(jsonb) IMMUTABLE`**: PostgreSQL no permite
  subconsultas dentro de un CHECK y envolver la validación en una función es el workaround
  estándar (`IMMUTABLE` es honesto: el resultado solo depende del argumento, con
  `search_path` fijado). Valida que la raíz sea objeto y que cada entrada (`jsonb_each`) sea
  objeto con `sortBy` text **no vacío** y `direction in ('asc','desc')`;
  `coalesce(bool_and(...), true)` hace que `'{}'` (sin entradas) pase. Deliberadamente **NO
  valida claves superiores ni valores concretos de `sortBy`**: añadir un listado futuro no
  exige tocar la BD.
- Trigger `trg_user_preferences_updated_at` (`BEFORE UPDATE`) reutilizando
  `umsuka.update_updated_at_column()` (0018) verbatim, precedido de `drop trigger if exists`.
- **Sin índices adicionales**: todo acceso filtra por el PK `user_id`. **Sin grants a
  `service_role`**: a diferencia de `notification_preferences` (que el emisor bulk toca en
  nombre de terceros), aquí solo el actor autenticado lee/escribe su propia fila vía RLS.
- **RLS `ENABLE` + `FORCE ROW LEVEL SECURITY`** con 4 políticas own-row espejo de 0052:

| Política | Operación | Regla |
|---|---|---|
| `user_preferences_select_own` | SELECT | `to authenticated using (user_id = auth.uid())` |
| `user_preferences_insert_own` | INSERT | `to authenticated with check (user_id = auth.uid())` |
| `user_preferences_update_own` | UPDATE | `to authenticated using / with check (user_id = auth.uid())` |
| `user_preferences_delete_own` | DELETE | `to authenticated using (user_id = auth.uid())` |

- La migración incluye comentarios de tabla/columna/función y un **checklist manual
  pre-deploy** con la matización de idempotencia: `create table if not exists` y el
  `drop/create trigger` son re-ejecutables, pero el `add constraint` plano fallaría con
  «constraint already exists» en una segunda ejecución (convención del repo: las migraciones
  corren una vez vía `supabase db push`).

### D2 — Documento persistido `{ <listId>: { sortBy, direction } }`: claves ausentes = defaults, strip Zod = forward-compatible

Forma almacenada en `list_ordering` y criterios por listado (AC1):

| ListId | Criterios (`sortBy`) válidos | Default |
|---|---|---|
| `members` | `name`, `created_at`, `workgroup`, `component_type` | `name asc` |
| `instruments` | `name`, `category`, `created_at`, `assignee` (null si sin responsable) | `name asc` |
| `events` | `event_date`, `title`, `created_at` | `event_date asc` |

- Los defaults reproducen **exactamente el comportamiento previo** de cada listado: hasta que
  el usuario guarda una preferencia, la página se ve igual que antes del sprint.
- Cada entrada es **opcional**: clave ausente → `DEFAULT_SORT` del listado.
- `listOrderingSchema` (`z.object`) hace **strip de claves desconocidas**: un documento
  escrito por una versión futura de la app parsea limpio en lugar de descartarse entero
  (**forward-compatible**).
- `saveListOrderingInputSchema` valida el payload de guardado (`listId` enum, `sortBy`
  string no vacío, `direction` enum); la **validación cruzada campo↔listado**
  (`SORT_FIELDS_BY_LIST`) ocurre en la mutation para poder nombrar al listado en el mensaje
  de error. Las opciones de UI van etiquetadas en español (`MEMBER_SORT_OPTIONS`,
  `INSTRUMENT_SORT_OPTIONS`, `EVENT_SORT_OPTIONS`).

### D3 — Ordenación server-side post-fetch con contrato «ordenar siempre antes de recortar»

- **No se añaden query params ni `ORDER BY` dinámico en SQL**: las queries existentes
  conservan su `ORDER BY` como línea base estable y `applySorting` (JS determinista, D7) lo
  sobreescribe tras el fetch/filtrado. Los `searchParams` de `/members` quedan intactos: los
  filtros siguen mandando y la ordenación es ortogonal a ellos.
- Integración por página (server components):
  - **`/members`**: sort tras `filterMembers(result.data, filters)`; control renderizado
    junto a `MemberFiltersControl` dentro del mismo contenedor flex.
  - **`/instruments`**: sort del set completo fetched antes del grid; el control **solo se
    muestra si hay instrumentos** (el estado vacío no ofrece ordenar).
  - **`/events`**: sort tras `listEvents` (que ya aplica el filtrado de audiencia del
    viewer); los `Map` de counts de los badges de audiencia se calculan sobre la lista ya
    ordenada, por lo que son **insensibles al orden**.
- Contrato documentado en el docstring de `sorting.ts`: la ordenación corre **siempre
  después** del fetch/filtrado y **antes** de cualquier slicing/paginación futura. Hoy no hay
  paginación; el contrato blinda el AC «antes de paginar» para quien la añada.

### D4 — Server action compartida `src/lib/ordering/actions.ts` + componente cliente controlado

- `saveListOrderingAction` vive en **`src/lib/ordering/actions.ts`** (`"use server"`): única
  desviación puntual de la convención `app/**/actions.ts`, justificada porque la consumen
  tres rutas y amparada por el precedente `src/app/events/audience-actions.ts`. El módulo
  exporta solo funciones async (+ re-exports de tipos).
- Delega en `saveListOrdering` y hace `revalidatePath("/members")`,
  `revalidatePath("/instruments")` y `revalidatePath("/events")` **solo en éxito**; captura
  el throw de `requireAuthenticatedProfile` (sin sesión activa) devolviendo un mensaje
  amigable.
- **`ListSortingControl`** (`src/components/list-sorting.tsx`): cliente **100 % controlado
  por props** — el render del servidor es la única fuente de verdad, sin estado local. Dos
  `Select` nativos `h-8 w-auto text-xs` con `aria-label` «Ordenar por» y «Dirección de
  ordenación»; cada cambio envía el par completo (el valor no tocado se toma de las props
  actuales) dentro de `startTransition` + `router.refresh()`, con ambos selects
  `disabled={isPending}` durante el guardado.

### D5 — Escritura merge read-modify-write + upsert con doble scope

`saveListOrdering` (`src/lib/ordering/mutations.ts`) ejecuta, en este orden:

1. Parse Zod (`saveListOrderingInputSchema`) — rechaza input inválido **sin tocar la BD**.
2. Validación cruzada contra `SORT_FIELDS_BY_LIST`: «Campo de ordenación no válido para el
   listado "X".» (p. ej. `assignee` sobre `/members`).
3. `requireAuthenticatedProfile()` — el actor debe tener sesión y perfil aprobado.
4. **SELECT propio** (`maybeSingle`, `.eq("user_id", actor.id)`): lectura de la fila actual
   para **mergear en JS** (`{ ...current, [listId]: { sortBy, direction } }`) y nunca
   reemplazar los sorts guardados de los otros listados.
5. **UPSERT** con `onConflict: "user_id"` (patrón `updateNotificationPreferences`). Sin RPC
   `SECURITY DEFINER`.

**Doble scope**: `listId`/`sortBy`/`direction` vienen del cliente, pero `user_id` **jamás** —
siempre es el id del actor autenticado. La mutation es la defensa primaria y las políticas
own-row de RLS la de respaldo. Ventana de carrera aceptada: dos pestañas de la misma cuenta →
la última escritura gana sobre el documento completo (estado auto-reparable re-guardando);
entre cuentas distintas es imposible tocar una fila ajena (scope + RLS).

### D6 — Lectura fail-open

`getListOrdering(userId)` (`src/lib/ordering/queries.ts`):

- `userId` llega **solo de la sesión** del server component llamante (p. ej. `profile.id`
  tras la gate de auth) — nunca de input cliente; contrato documentado en el docstring.
- Error de BD/red → `console.error` + `{}` (defaults). Fila ausente → `{}`. Jsonb corrupto →
  `parseListOrdering` hace `safeParse`, loguea `console.warn` y devuelve `{}`.
- Principio: **una preferencia rota nunca debe tumbar un listado** — toda lectura degrada al
  orden por defecto.

### D7 — Motor de ordenación determinista `applySorting`

Función **genérica, pura y no mutante** (`[...items].sort()` devuelve array nuevo; la entrada
no se toca), importable desde cliente y servidor gracias a `import type` (los tipos de dominio
se borran en compile time y ningún módulo de servidor acaba en el bundle cliente). Reglas:

- **Strings**: `localeCompare(x, "es", { sensitivity: "base", numeric: true })` —
  «Álvaro» ≡ «alvaro» (acento/mayúscula irrelevantes) y «Turno 2» < «Turno 10» (dígitos
  comparados numéricamente).
- **Números**: comparación numérica; las fechas se convierten con `Date.parse` a epoch millis.
- **null/undefined/NaN SIEMPRE al final, en ambas direcciones** (`asc` y `desc`): afecta a
  `category` vacía, instrumento sin responsable (`assignee` → null) y fecha corrupta (un
  `Date.parse` inválido produce NaN, que degrada a *missing*).
- Empates: caen al selector siguiente y el **tie-breaker final es `id` ascendente**, de modo
  que la salida es determinista con independencia del orden de entrada o de la estabilidad
  del algoritmo de sort.

`sortMembers` / `sortInstruments` / `sortEvents` son wrappers con selectores tipados por
listado (`MEMBER_SELECTORS`, `INSTRUMENT_SELECTORS`, `EVENT_SELECTORS`).

### D8 — Sin seeds ni cambios en `handle_new_user()`

El trigger de signup auto-provisiona `profiles` y `notification_preferences` (0052) pero
**no** se modifica para crear `user_preferences`: la fila ausente está soportada de serie
(`maybeSingle` → `{}` → defaults) y nace con el primer guardado. Menos escrituras en cada
alta y cero acoplamiento entre signup y preferencias.

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| RPC `SECURITY DEFINER` de merge atómico (leer+merge+upsert dentro de la BD) | Eliminaría la ventana de carrera de D5, que solo es alcanzable entre pestañas de la misma cuenta y es auto-reparable («última escritura gana»). Añadiría superficie `SECURITY DEFINER` nueva y grants para un riesgo cosmético; el repo reserva `SECURITY DEFINER` para helpers de lectura/rol, no para escrituras de preferencias. |
| Una columna o tabla por listado (`member_sort`, `instrument_sort`, …) | Cada listado nuevo exigiría migración + tipos + políticas repetidas. El jsonb único con CHECK de sobreestructura (D1/D2) absorbe listados futuros **sin tocar la BD**; el strip Zod mantiene la compatibilidad hacia delante. |
| Ordenación vía query params URL (`?sort=name&dir=asc`) | No persiste entre visitas/sesiones (requisito central del sprint), contamina URLs compartidas/bookmarks y obligaría a tocar los `searchParams` de `/members` ya ocupados por los filtros. |
| `ORDER BY` dinámico en SQL con whitelist de columnas | Requeriría duplicar la whitelist en cada query y acoplarse al SQL de tres módulos; el sort JS post-fetch (D3/D7) deja las queries intactas (cero riesgo de regresión) y concentra las reglas (collation `es`, nulls al final, tie-breaker) en un único motor testeable. |
| `Array.prototype.toSorted` (ES2023) | El target del proyecto es ES2022; `[...items].sort()` consigue el mismo resultado no mutante sin subir target ni tocar `tsconfig`. |
| Seed de la fila en `handle_new_user()` | Escritura extra en cada alta para una preferencia que quizá nunca se guarde; la fila ausente ya está soportada (`maybeSingle` → `{}`) y la fila nace con el primer guardado (D8). |

---

## Edge cases manejados

| Escenario | Comportamiento |
|---|---|
| jsonb corrupto almacenado en BD | Triple barrera: el CHECK (23514) impide escribir documentos inválidos; si algo corrupto llegase a estar almacenado, `parseListOrdering` degrada a `{}` con warn; `getListOrdering` es fail-open ante errores de lectura (D1/D6) |
| Usuario sin fila de preferencias (caso normal) | `maybeSingle()` → null → `{}` → `DEFAULT_SORT`; sin seeds (D8) |
| Clave de listado desconocida o futura en el documento | Strip de `z.object`: se ignora silenciosamente sin romper el resto del documento (forward-compatible) |
| Entrada conocida pero inválida (p. ej. `sortBy` retirado del enum) | El `safeParse` del documento completo falla → degrada a `{}` → defaults de todos los listados (fail-closed deliberadamente simple) |
| Dos pestañas de la misma cuenta guardan a la vez | Read-modify-write no atómico: la última escritura gana sobre el documento completo; estado auto-reparable re-guardando (D5) |
| Nombres con acentos o mayúsculas («Álvaro» / «alvaro») | `localeCompare("es", { sensitivity: "base" })`: equivalencia acento/mayúscula (D7) |
| Cifras dentro del texto («Turno 2» vs «Turno 10») | `numeric: true`: 2 se ordena antes que 10 (D7) |
| `category` vacía o instrumento sin responsable (`assignee` null) | Hundidos SIEMPRE al final, tanto en `asc` como en `desc` (D7) |
| Fecha corrupta o imparseable (`Date.parse` → NaN) | Degrada a *missing* y se hunde al final como los nulls (D7) |
| Empates totales (mismo valor en el criterio) | Tie-breaker final `id` asc → salida determinista independiente del orden de entrada (D7) |
| Listado vacío (`/instruments` sin instrumentos) | Estado vacío sin control de ordenación (D3) |
| Paginación futura | Contrato D3: el sort corre antes de cualquier slicing; hoy no hay paginación y el AC queda blindado para quien la añada |
| Re-ejecución de la migración | Trigger idempotente (`drop trigger if exists`), pero el `add constraint` NO lo es: checklist lo matiza explícitamente (D1) |

---

## Consecuencias

### Positivas

- **Preferencia de ordenación persistente** por usuario en los tres listados principales,
  re-aplicada en cada visita; defaults idénticos al comportamiento previo (cero cambio
  visible hasta que el usuario ordena).
- **Tabla genérica `user_preferences`** lista para futuros grupos de preferencias sin
  migraciones nuevas por preferencia; el comentario de tabla documenta la política.
- **Forward-compatible** por diseño: strip de claves desconocidas + CHECK de sobreestructura
  → añadir un listado no exige tocar la BD ni invalida documentos antiguos.
- **Fail-open total en lectura**: preferencia ausente, corrupta o ileíble jamás tumba un
  listado (degrada a defaults).
- **Queries existentes intactas**: cero riesgo de regresión en SQL/filtros; las reglas de
  ordenación viven en un único motor puro y testeable.
- **Suite nueva verde**: 44 tests nuevos (17 de schema + 15 de sorting + 12 de mutations),
  elevando el total a 83 archivos / 1204 tests.

### Seguridad (defensa en profundidad)

- `ENABLE` + **`FORCE` RLS** con 4 políticas own-row: ningún usuario lee o escribe filas
  ajenas, ni siquiera siendo propietario de la tabla.
- **Doble scope en escritura**: la mutation fuerza `user_id = actor.id` (defensa primaria) y
  las políticas `using / with check (user_id = auth.uid())` respaldan en BD frente a clientes
  que ataquen PostgREST directamente.
- **Lectura con `userId` solo de sesión** (contrato documentado en `queries.ts`), nunca de
  input cliente.
- Validación Zod + cruzada campo↔listado **antes** de tocar la BD; mensajes de error
  acotados en español.
- **Sin grants `service_role`**: no existe escritura en nombre de terceros (a diferencia de
  `notification_preferences`, cuyo emisor bulk sí la necesitaba).
- Security scan del pipeline (security-champion): **CLEAN — 0 HIGH** (estado
  `security-cleared` del task file).

### Trade-offs aceptados / hallazgos conocidos

1. **Read-modify-write no atómico** (D5): dos pestañas de la misma cuenta pueden pisarse el
   documento completo (gana la última escritura, perdiendo el sort de la otra lista cambiado
   en paralelo). Aceptado: mismo-cuenta, auto-reparable y evitarlo exigiría una RPC
   `SECURITY DEFINER` nueva.
2. **Fallback `error.message` crudo al cliente** en `mutations.ts:59,79` (hallazgo MEDIUM
   informativo no bloqueante del security scan): patrón consistente del repo, ya aceptado y
   documentado en Sprint 24; los errores propios de select/upsert exponen el mensaje crudo de
   PostgREST.
3. **Objetos de error completos en logs de servidor** (LOW): sin PII; facilitan depurar
   fallos de BD.
4. **jsonb sin CHECK de tamaño** (INFO): mitigado aplicativamente por Zod (strip de claves +
   enums acotados → documentos pequeños por construcción).
5. **`add constraint` no idempotente**: re-ejecutar la migración completa fallaría en ese
   statement («constraint already exists»); matizado en el checklist manual (convención del
   repo: las migraciones corren una vez vía `supabase db push`).
6. **Sort JS post-fetch en lugar de `ORDER BY` SQL**: coste O(n log n) por request sobre
   conjuntos acotados (tamaño de comparsa), a cambio de queries intactas y reglas
   centralizadas en un único motor.
7. **Entrada conocida pero inválida degrada TODO el documento a `{}`** (no solo la entrada):
   simplicidad deliberada del fail-safe; la corrección es volver a guardar la preferencia.
8. **SQL hand-reasoned**: sin Supabase local/CLI en el entorno; checklist manual pre-deploy
   incluido en la migración (patrón de sprints previos).
9. **Documentación de BD pendiente** (deuda preexistente, no introducida por este sprint):
   `docs/DATABASE.md` aún no recoge las migraciones 0056 (Sprint 24) ni la 0059 de este
   sprint; deberán añadirse en una ronda de docs-sync.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101005900_user_preferences.sql` | CREATE — tabla `umsuka.user_preferences` (PK FK cascade, jsonb default '{}'), CHECK de sobreestructura vía función `IMMUTABLE umsuka.is_valid_list_ordering(jsonb)`, trigger `updated_at` (0018) con `drop trigger if exists`, RLS enable+force con 4 políticas own-row (espejo 0052), comentarios y checklist manual pre-deploy |
| `src/types/database.types.ts` | MODIFY — entrada manual `user_preferences` (Row/Insert/Update con el tipo `Json` existente) |
| `src/lib/ordering/schema.ts` | CREATE — `LIST_IDS`, `SORT_DIRECTIONS`, tuples de campos por listado, `SORT_FIELDS_BY_LIST` (validación cruzada), `listOrderingSchema` (strip), `parseListOrdering` fail-safe, `DEFAULT_SORT`, `saveListOrderingInputSchema` y opciones etiquetadas en español |
| `src/lib/ordering/sorting.ts` | CREATE — `applySorting` genérico (localeCompare `es`, fechas epoch, nulls/NaN al final, tie-breaker `id`) + `sortMembers`/`sortInstruments`/`sortEvents` con selectores tipados |
| `src/lib/ordering/queries.ts` | CREATE — `getListOrdering(userId)` fail-open (`userId` solo de sesión server component) |
| `src/lib/ordering/mutations.ts` | CREATE — `saveListOrdering` (Zod → validación cruzada → actor → SELECT propio → merge JS → upsert `onConflict user_id`) + `MutationResult` |
| `src/lib/ordering/actions.ts` | CREATE — `saveListOrderingAction` ("use server"; `revalidatePath` x3 solo en éxito) |
| `src/components/list-sorting.tsx` | CREATE — cliente controlado por props: 2 Select nativos con aria-labels, `startTransition` + `router.refresh()`, `disabled={isPending}` |
| `src/app/members/page.tsx` | MODIFY — sort tras `filterMembers`, control junto a `MemberFiltersControl` |
| `src/app/instruments/page.tsx` | MODIFY — sort antes del grid; control solo si hay instrumentos |
| `src/app/events/page.tsx` | MODIFY — sort tras `listEvents` (audiencia ya filtrada); counts insensibles al orden |
| `tests/unit/lib/ordering-schema.test.ts` | CREATE — 17 tests del schema Zod |
| `tests/unit/lib/ordering-sorting.test.ts` | CREATE — 15 tests del motor de ordenación |
| `tests/unit/lib/ordering-mutations.test.ts` | CREATE — 12 tests de mutations (chain-builder mockeado, doble scope) |
| `tasks/sprint-25-list-ordering.json` | CREATE — tarea del sprint |
| `docs/adr-sprint-25-list-ordering.md` | CREATE — este ADR |

### Tests

| Archivo | Tests |
|---|---|
| `tests/unit/lib/ordering-schema.test.ts` (CREATE) | 17 — documento completo/parcial, strip de claves desconocidas, rechazo de sortBy/direction/entrada/raíz inválidos, fail-safe de `parseListOrdering` (null/string/array/número y entradas inválidas → `{}`), validación cruzada `SORT_FIELDS_BY_LIST` (incluido members+assignee inválido e instruments+assignee válido), direcciones/listados expuestos, defaults documentados y etiquetado de opciones |
| `tests/unit/lib/ordering-sorting.test.ts` (CREATE) | 15 — multi-selector, no-mutación del array, arrays vacío/unitarios, equivalencia acento/mayúscula («Álvaro» ≡ «alvaro»), reversión con `desc`, fechas cronológicas, workgroup/component_type, tie-breaker por `id`, nulls al final en asc Y desc (category y assignee), dígitos numéricos («Turno 2» < «Turno 10»), eventos por fecha/título, fecha imparseable hundida al final |
| `tests/unit/lib/ordering-mutations.test.ts` (CREATE) | 12 — upsert mergeado con `user_id = actor.id`, preservación de los otros listados en el merge, sobrescritura solo del listado objetivo, input inválido sin tocar BD, validación cruzada (members+assignee rechazado, instruments+assignee aceptado), merge desde fila ausente, recuperación de jsonb corrupto, error crudo de upsert/select propagado, propagación sin sesión, doble scope (`user_id` jamás del cliente) |

**Verificado en local (2026-08-24):** `npx vitest run` → **1204 tests en 83 archivos, todos
pasando**; `npx tsc --noEmit` limpio; `npx eslint . --max-warnings=0` limpio; `npx next
build` sin errores. Security scan del pipeline: CLEAN, 0 HIGH (estado `security-cleared` del
task file).

---

## Referencias

- Task file: `tasks/sprint-25-list-ordering.json` (criterios de aceptación, DoD — incluye
  este ADR como entregable; dependencias: Sprint 14 — Listado de Miembros, y Sprint 19 —
  Perfiles, cuya provisión de preferencias quedó finalmente en esta tabla dedicada).
- ADR-020 (Sprint 20 — Notificaciones): origen del patrón replicado verbatim — tabla por
  usuario con PK FK `auth.users ON DELETE CASCADE` (0052), RLS own-row en 4 políticas y
  merge + upsert `onConflict user_id` (`updateNotificationPreferences`).
- ADR-024 (Sprint 24 — Gestión de Instrumentos): formato de este ADR, patrón de fallback
  `error.message` crudo aceptado (hallazgo MEDIUM informativo) y checklist manual pre-deploy;
  sus campos `name`/`category`/`created_at`/responsable son hoy selectores del listado de
  instrumentos.
- Migraciones base reutilizadas: 0000 (`init_schema`, `auth.users` referenciada por la FK),
  0013 (helpers RLS), 0018 (`umsuka.update_updated_at_column()`) y 0052
  (`notification_preferences`, espejo estructural de este sprint).
- Directivas globales: `docs/git-conventions.md` (rama
  `feature/sprint-25-list-ordering`, commits semánticos
  `feat(sprint-25)`/`test(sprint-25)`/`fix(sprint-25)` ya aplicados en la rama; PR y escaneo
  security-champion gestionados por el Publisher en el cierre del sprint).
