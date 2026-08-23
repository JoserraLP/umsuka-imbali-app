# ADR-027: Sprint 27 — Asistencia a Ensayos (Rehearsal Attendance)

**Status:** Accepted (Implementado) · **Date:** 2026-08-21 · **Sprint:** 27 ·
**Branch:** `feature/sprint-27-rehearsal-attendance`

---

## Context

Los ensayos de la comparsa se celebran en **dos sesiones** (mañana y tarde) y la directiva
necesita registrar **quién asistió a cada sesión** de cada ensayo. Un ensayo es un evento de
tipo `rehearsal`; los responsables marcan la asistencia por sesión y las estadísticas
resultantes alimentan el **porcentaje de participación** del perfil de cada miembro.

La tabla de asistencia genérica del **Sprint 5** no puede expresar esta necesidad: modela
**una fila por (evento, miembro)**, sin dimensión de sesión, por lo que no distingue un
miembro presente solo por la mañana de uno presente todo el día. Forzar esa tabla habría
contaminado el modelo existente (constraints, RLS y queries asumen una marca única por
evento). Este sprint añade el flujo de asistencia por sesión como módulo propio.

Requisitos (criterios de aceptación del task file):

- Se pueden crear eventos de tipo **«ensayo»** con sesión de mañana y/o tarde.
- Los responsables pueden **marcar asistencia por sesión** (mañana/tarde).
- La asistencia a ensayos se refleja en las **estadísticas del perfil** de cada miembro
  (% de participación).
- La tabla `rehearsal_attendance` registra correctamente la **sesión** (mañana/tarde),
  **quién asistió** y **quién marcó** la asistencia.

Dependencias declaradas: **Sprint 5 (Asistencia y Ausencias)** y **Sprint 17 (Eventos)**.

### Estado previo

- **Asistencia genérica (Sprint 5)**: `markAttendance`/`markMultipleAttendance` sobre su
  tabla propia, con guard de management y una marca por evento; sin concepto de sesión.
- **Eventos (Sprint 17)**: `ATTENDANCE_ONLY_EVENT_TYPES = ["meeting", "carnival"]` y el
  patrón fail-closed `rejectAttendanceOnlyEvent` (`src/lib/events/policy.ts`) ya rechazaban
  turnos/ausencias/asistencia por grupo para esos tipos; `rehearsal` no existía como valor
  de `umsuka.event_type`.
- Patrones del repo reutilizados tal cual:
  - Guard de rol local en mutations con `isManagementRole` (patrón
    `requireManagementGuard` de `src/lib/instruments/mutations.ts`, Sprint 24).
  - Lectura fail-closed del evento real antes de escribir (patrón
    `rejectAttendanceOnlyEvent` de policy.ts: error de lectura o evento ausente → abortar).
  - Merge en JS con una query extra de perfiles (patrón `getEventComments` /
    `attendance/queries.ts`) para resolver nombres **sin N+1**.
  - Trigger `umsuka.update_updated_at_column()` (0018) para `updated_at`.
  - Helper RLS **`umsuka.is_management()`** (0013), cuyo conjunto de roles es idéntico a
    `MANAGEMENT_ROLES` de `src/lib/auth/roles.ts`.
- Última migración: 0056 (`instruments`, Sprint 24); 0057/0058 como siguiente numeración.
- `src/types/database.types.ts` sin tipos de ensayos ni de `rehearsal_session`.

---

## Decisión

> **Nota de numeración:** los identificadores D1–D8 replican los del task file
> (`tasks/sprint-27-rehearsal-attendance.json`), que no define D6.

### D1 — Modelado de sesiones: dos booleanos en `events` + ENUM `umsuka.rehearsal_session`

Las sesiones declaradas de un ensayo viven en el propio evento; la asistencia marcada
referencia la sesión mediante un enum dedicado:

| Elemento | Definición |
|---|---|
| `umsuka.events.morning_session` | `boolean NOT NULL DEFAULT false` — el ensayo tiene sesión de mañana abierta a asistencia |
| `umsuka.events.afternoon_session` | `boolean NOT NULL DEFAULT false` — ídem, sesión de tarde |
| CHECK `chk_events_rehearsal_has_session` | `event_type <> 'rehearsal' OR morning_session OR afternoon_session` — un ensayo declara **al menos una** sesión |
| CHECK `chk_events_non_rehearsal_no_sessions` | `event_type = 'rehearsal' OR (NOT morning_session AND NOT afternoon_session)` — ningún otro tipo de evento declara sesiones |
| `CREATE TYPE umsuka.rehearsal_session` | `ENUM ('morning', 'afternoon')` — sesión referida por cada fila de asistencia |

Espejo en aplicación (`src/lib/events/schema.ts`): `EVENT_TYPES` incorpora `"rehearsal"`,
los flags son opcionales en el form y una refinement cross-field exige al menos una sesión
en ensayos; `updateEvent`/`createEvent` **normalizan ambos flags a `false` para eventos no
ensayo**, de modo que el CHECK de BD nunca tropieza con flags obsoletos de un form stale.
`src/lib/rehearsals/schema.ts` define `REHEARSAL_SESSIONS` (orden de display) y
`SESSION_LABELS` («Mañana»/«Tarde»), espejo exacto del enum.

### D2 — Marcado exclusivo de la directiva: `is_management()` / `isManagementRole()`

Solo `MANAGEMENT_ROLES` (`super_admin`, `admin`, `board_member`, `event_manager`) marcan,
actualizan o limpian asistencia a ensayos:

- **Capa de aplicación**: guard local `requireManagementGuard` en las **3 mutations** de
  `src/lib/rehearsals/mutations.ts` (patrón instruments/votings) usando
  `isManagementRole(actor.role)` de `src/lib/auth/roles.ts`; devuelve
  «Solo la directiva puede registrar asistencia a ensayos.» **antes de cualquier escritura**.
- **Capa de base de datos**: la política de escritura RLS usa el helper preexistente
  **`umsuka.is_management()`** (0013). No se crea ningún helper nuevo: mismo conjunto de
  roles en BD y app, cero riesgo de divergencia.

### D3 — `UNIQUE(event_id, user_id, session)` + upsert `onConflict` + `marked_by` server-side

La regla «una fila de asistencia por miembro, ensayo y sesión» se garantiza en BD con la
constraint `rehearsal_attendance_event_user_session_unique` sobre
**(event_id, user_id, session)**:

- El marcado usa **upsert** con `{ onConflict: "event_id,user_id,session" }`: remarcar a un
  miembro **actualiza** su fila (asistencia y `marked_by`) en lugar de duplicarla; el mismo
  miembro sí puede tener una fila de mañana **y** otra de tarde.
- **`marked_by` siempre se estampa server-side** desde el perfil autenticado
  (`authResult.id` del guard): nunca llega del cliente. `ON DELETE SET NULL` conserva la
  fila si la cuenta del marcador desaparece.
- Un INSERT duplicado que pierda una carrera contra otro directivo produce **23505**,
  mapeado al mensaje amigable «Ya existe un registro de asistencia para esa sesión.»
  (el upsert hace que este caso sea residual, pero queda cubierto).

### D4 — Defensa en tres capas + guard inverso en la asistencia genérica

1. **UI gating**: `RehearsalAttendancePanel` solo se renderiza en `/events/[id]` para
   eventos `rehearsal` y solo para management; los toggles de una sesión no declarada no
   existen en el DOM.
2. **Servidor fail-closed leyendo el evento real**: `fetchRehearsalEvent` consulta
   `event_type, morning_session, afternoon_session` del evento; cualquier error de lectura
   o evento inexistente aborta («Evento no encontrado.»), un evento no-ensayo se rechaza
   («La asistencia por sesiones solo aplica a eventos de tipo ensayo.») y
   `assertSessionEnabled` rechaza sesiones no declaradas («Este ensayo no tiene sesión de
   mañana/tarde.»). Nunca se confía en datos del formulario.
3. **RLS + constraints**: `ENABLE` + `FORCE ROW LEVEL SECURITY`; escritura solo vía
   `umsuka.is_management()`; la constraint triple única cierra el último caso (carrera).

Además, `'rehearsal'` se añadió a **`ATTENDANCE_ONLY_EVENT_TYPES`**
(`src/lib/events/policy.ts`), de modo que el `markAttendance` genérico del Sprint 5 lo
rechaza con el guard inverso `rejectRehearsalEvent` y el mensaje
`REHEARSAL_SESSIONS_UNAVAILABLE_MESSAGE` («Para ensayos usa el registro de asistencia por
sesión.»). Ningún flujo puede mezclar ambas tablas de asistencia.

### D5 — `participationRate = attended / marked · 100`, 1 decimal, `null` si nada marcado

`src/lib/rehearsals/stats.ts` expone dos helpers puros:

- `computeRehearsalParticipation(marks)` — porcentaje sobre las filas marcadas de un
  miembro en un ensayo.
- `computeParticipationFromCounts(attended, marked)` — variante por recuentos usada por
  `/profile` y `/members/[id]`, donde solo hay agregados (head-count).

Ambos devuelven `Math.round((attended / marked) * 1000) / 10` (**redondeo a 1 decimal**) y
**`null` cuando no hay nada marcado** (`marked <= 0`), para que la UI renderice «—» en vez
de un falso 0 %. Ejemplos verificados en tests: 5/8 → 62.5, 1/3 → 33.3, 3/3 → 100, 0/7 → 0.

### Complemento — server actions thin y panel `/events/[id]`

- `src/app/events/[id]/rehearsal-actions.ts`: `markRehearsalAttendanceAction`,
  `markMultipleRehearsalAttendanceAction` y `clearRehearsalSessionAction` — wrappers thin
  que delegan en las mutations y, **solo en éxito**, revalidan `/events/{eventId}` y
  `/profile` (el detalle del ensayo y el tile de participación leen estos datos).
- `rehearsal-attendance-panel.tsx`: panel por sesión con lista de miembros, marcado
  individual y masivo, y «limpiar sesión»; errores con `role="alert"` y `router.refresh()`.
- Integración de eventos: `event-form.tsx` añade los checkboxes Mañana/Tarde (visibles solo
  para `rehearsal`), y `events/mutations.ts` **bloquea conversiones de tipo hacia/desde
  `rehearsal`** en `updateEvent` (un evento no muta su naturaleza de sesión).

### D7 — Dos migraciones: la restricción `ALTER TYPE ADD VALUE` de PostgreSQL

PostgreSQL prohíbe usar dentro de una transacción un valor añadido con
`ALTER TYPE ... ADD VALUE` en esa misma transacción (y Supabase envuelve **cada archivo de
migración en exactamente una transacción**). Como los CHECKs de 0058 comparan
`event_type` con `'rehearsal'`, la extensión del enum vive sola en su propio archivo:

1. **`20260101005700_rehearsal_event_type.sql`** — `ALTER TYPE umsuka.event_type ADD VALUE
   IF NOT EXISTS 'rehearsal' AFTER 'work_shift'` + comentarios de tipo/columna
   sincronizados + checklist manual pre-deploy. Idempotente (`IF NOT EXISTS`).
2. **`20260101005800_rehearsal_attendance.sql`** — columnas `morning_session`/
   `afternoon_session` + CHECKs coherentes, ENUM `umsuka.rehearsal_session`, tabla
   `umsuka.rehearsal_attendance` (FKs `ON DELETE CASCADE` a `events`/`auth.users`,
   `marked_by ON DELETE SET NULL`, constraint única triple), trigger `updated_at` (0018),
   índices `idx_rehearsal_attendance_event_session` e `idx_rehearsal_attendance_user_id`
   (panel y estadísticas), RLS enable+force con política SELECT
   `rehearsal_attendance_select_own_or_management` (fila propia **o** management) y
   política FOR ALL `rehearsal_attendance_write_management` (solo management), más
   checklist manual pre-deploy. Se aplica **después** de que la transacción de 0057 haya
   hecho commit.

Ambas siguen el patrón hand-reasoned de sprints previos (sin Supabase local/CLI en el
entorno) y quedan registradas en `docs/DATABASE.md`.

### D8 — `database.types.ts` editado a mano (sin CLI Supabase)

Sin Supabase local/CLI en el entorno, `src/types/database.types.ts` se editó a mano:
tipos `Row`/`Insert`/`Update` de `rehearsal_attendance`, columnas de sesión en `events`,
valor `'rehearsal'` en el union de `event_type` y el tipo `RehearsalSession`
(`'morning' | 'afternoon'`) consumido por schema/queries/mutations. Los tests de esquema
verifican la coherencia entre `REHEARSAL_SESSIONS` y el union tipado.

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| **Una sola migración** (enum + tabla juntas) | PostgreSQL no permite usar en una transacción un valor añadido con `ALTER TYPE ... ADD VALUE` en esa misma transacción; Supabase envuelve cada archivo en exactamente una transacción, así que los CHECKs de 0058 que comparan con `'rehearsal'` fallarían si compartieran archivo con el `ADD VALUE`. Dos archivos = dos commits secuenciales y despliegue determinista. |
| **Batch upsert en una sola llamada** para el marcado masivo | Supabase JS no soporta upsert masivo con *conflict target* explícito. Se eligió un **bucle de upserts individuales** tras validar el ensayo una sola vez, con parada en el primer fallo y reporte por registro: `Error for user <id>: <msg>` — el directivo sabe exactamente a qué miembro revisar. El reintento es seguro porque cada upsert es idempotente sobre la constraint triple. |
| **Columna `session` en la tabla genérica de asistencia (Sprint 5)** | Contaminaría el modelo existente: su semántica (una marca por evento), constraints, RLS y queries asumen ausencia de sesión; añadir la dimensión rompería o forzaría migraciones en todos los flujos del Sprint 5. La tabla dedicada `rehearsal_attendance` mantiene ambos dominios aislados y el guard inverso de D4 impide cruces accidentales. |

---

## Edge cases manejados

| Escenario | Comportamiento |
|---|---|
| Remarcar a un miembro en la misma sesión | Upsert sobre la fila existente (`onConflict "event_id,user_id,session"`): actualiza `attended` y `marked_by`, nunca duplica (D3) |
| Carrera: dos directivos insertan la misma fila a la vez | El segundo viola la constraint triple → 23505 → «Ya existe un registro de asistencia para esa sesión.» |
| Marcar una sesión que el ensayo no declara | Servidor: «Este ensayo no tiene sesión de mañana.» / «…de tarde.»; la UI ni muestra el toggle |
| Evento inexistente o invisible para el actor | Fail-closed: «Evento no encontrado.» antes de cualquier escritura (D4, capa 2) |
| Mutation de ensayos invocada sobre un evento genérico | «La asistencia por sesiones solo aplica a eventos de tipo ensayo.» |
| `markAttendance` genérico invocado sobre un ensayo | Guard inverso: «Para ensayos usa el registro de asistencia por sesión.» (D4) |
| Batch con registros de varios ensayos | Rechazado: «Todos los registros deben pertenecer al mismo ensayo.» |
| Fallo a mitad del batch | Parada en el primer registro fallido con `Error for user <id>: <msg>`; lo ya escrito persiste y el reintento es seguro (upsert idempotente) |
| Nadie marcado todavía | `participationRate` = `null` → la UI muestra «—», jamás un falso 0 % (D5) |
| Cuenta del marcador eliminada | `marked_by ON DELETE SET NULL`: la fila de asistencia sobrevive sin marcador |
| Conversión de un evento hacia/desde `rehearsal` | Bloqueada en `updateEvent`: un evento no cambia su naturaleza de sesión |
| Form stale: evento no-ensayo con flags de sesión en `true` | Normalización a `false` antes de persistir: `chk_events_non_rehearsal_no_sessions` nunca salta |
| Miembro con fila de mañana y de tarde | Válido: la unicidad es por (evento, miembro, **sesión**) |
| Perfil del asistente eliminado | Merge defensivo muestra «Miembro» como nombre; la fila de asistencia persiste (cascade solo vía borrado del usuario auth) |
| Re-ejecución de las migraciones | `ADD VALUE IF NOT EXISTS` y `drop trigger if exists`: re-ejecución segura (checklists manuales) |

---

## Consecuencias

### Positivas

- **Trazabilidad completa por sesión**: quién asistió a mañana y/o tarde de cada ensayo y
  qué directivo lo marcó, con historial conservado (`marked_by` nullable, sin borrados
  desde la app salvo la limpieza explícita de sesión).
- **Estadísticas integradas**: el % de participación por ensayos alimenta el tile de
  `/profile` y la ficha `/members/[id]` con redondeo a 1 decimal y semántica honesta
  (`null` = nada marcado).
- **Defensa en tres capas** (D4) con el mismo conjunto de roles en BD y app
  (`is_management()` ≡ `MANAGEMENT_ROLES`), más el guard inverso que aisla el flujo de
  ensayos del genérico.
- **Constraints expresan las reglas**: la triple unicidad y los dos CHECKs de sesión hacen
  imposibles los estados inválidos aunque un cliente ataque PostgREST directamente.
- **Queries sin N+1**: nombres de asistentes e historial por miembro se resuelven con
  merges en JS (dos queries batched por aspecto), patrón consolidado del repo.
- **Suite nueva verde**: 34 tests nuevos (11 schema + 7 stats + 16 mutations con el
  chain-builder mockeado, incluyendo guards inversos y fallo de batch con reporte por
  usuario).

### Seguridad (defensa en profundidad)

- `ENABLE` + **`FORCE ROW LEVEL SECURITY`** en `rehearsal_attendance`: ni el propietario de
  la tabla omite las políticas.
- SELECT limitado a **fila propia o management** (nunca `anon`); INSERT/UPDATE/DELETE
  exclusivamente vía `umsuka.is_management()` (helper `SECURITY DEFINER` de 0013 con
  `search_path` fijado y `grant execute` solo a `authenticated`).
- **`marked_by` inmutable desde el cliente**: siempre el actor autenticado, estampado en
  servidor; un payload manipulado no puede atribuir la marca a otro perfil.
- Validación fail-closed del evento real en cada mutation; mensajes de error acotados y en
  español; el `error.message` crudo solo aparece para códigos desconocidos (patrón del repo).
- Security scan del pipeline (security-champion): **CLEAN — 0 HIGH**.

### Trade-offs aceptados / hallazgos conocidos

1. **Bucle de upserts no atómico** (D3/alternativas): un fallo a mitad del marcado masivo
   deja las filas anteriores escritas. Aceptado: cada upsert es idempotente, el error se
   surfacea con el `user_id` afectado y el reintento completa el resto.
2. **Enum de sesiones cerrado** (`morning`/`afternoon`): añadir una tercera sesión exigiría
   nueva migración `ADD VALUE` (en archivo separado, misma restricción de D7) y cambios de
   tipos/UI. Aceptado: el modelo de dos sesiones es estable en el dominio.
3. **Conversiones de tipo bloqueadas**: un evento creado como `general` no puede convertirse
   en ensayo (ni viceversa); hay que crear el evento con el tipo correcto. Documentado como
   comportamiento esperado.
4. **SQL hand-reasoned**: sin Supabase local/CLI; ambas migraciones incluyen checklist
   manual pre-deploy para verificar enum, CHECKs, constraint única, trigger, índices, RLS y
   cascades en el momento del deploy.
5. **`database.types.ts` manual** (D8): sin generación CLI, la sincronía tipos↔esquema se
   apoya en los tests de esquema y en la revisión del PR.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101005700_rehearsal_event_type.sql` | CREATE — `ALTER TYPE umsuka.event_type ADD VALUE IF NOT EXISTS 'rehearsal' AFTER 'work_shift'` en transacción propia (restricción PG), comentarios sincronizados y checklist manual |
| `supabase/migrations/20260101005800_rehearsal_attendance.sql` | CREATE — columnas de sesión en `events` + CHECKs coherentes, ENUM `umsuka.rehearsal_session`, tabla `umsuka.rehearsal_attendance` (UNIQUE triple, FKs cascade, `marked_by` SET NULL), trigger `updated_at` (0018), índices, RLS enable+force (SELECT propia-o-management, FOR ALL management) y checklist manual |
| `src/types/database.types.ts` | MODIFY — edición manual (sin CLI): `RehearsalSession`, Row/Insert/Update de `rehearsal_attendance`, flags de sesión en `events`, `'rehearsal'` en `event_type` |
| `src/lib/rehearsals/schema.ts` | CREATE — `REHEARSAL_SESSIONS`, `SESSION_LABELS`, `isRehearsalSession`, schemas Zod `markRehearsalAttendanceSchema`, `markMultipleRehearsalAttendanceSchema`, `clearRehearsalSessionSchema` |
| `src/lib/rehearsals/stats.ts` | CREATE — `computeRehearsalParticipation` y `computeParticipationFromCounts` (1 decimal, `null` si nada marcado) |
| `src/lib/rehearsals/queries.ts` | CREATE — `getRehearsalAttendance` (merge de perfiles sin N+1), `getUserRehearsalAttendance`, `getUserEventSessionMarks`, `getRehearsalAttendanceSummary` |
| `src/lib/rehearsals/mutations.ts` | CREATE — `requireManagementGuard` local, `fetchRehearsalEvent` fail-closed, `assertSessionEnabled`; `markRehearsalAttendance` (upsert onConflict triple, `marked_by` server-side, mapeo 23505), `markMultipleRehearsalAttendance` (bucle con `Error for user <id>: <msg>`), `clearRehearsalSession` |
| `src/app/events/[id]/rehearsal-actions.ts` | CREATE — 3 server actions thin con `revalidatePath("/events/{id}")` + `/profile` solo en éxito |
| `src/app/events/[id]/rehearsal-attendance-panel.tsx` | CREATE — panel de marcado por sesión (individual, masivo y limpieza), gating por rol y sesión declarada |
| `src/lib/events/policy.ts` | MODIFY — `'rehearsal'` en `ATTENDANCE_ONLY_EVENT_TYPES` + `REHEARSAL_SESSIONS_UNAVAILABLE_MESSAGE` |
| `src/lib/events/schema.ts` | MODIFY — `"rehearsal"` en `EVENT_TYPES`, flags `morningSession`/`afternoonSession` con refinement «al menos una sesión» |
| `src/lib/events/mutations.ts` | MODIFY — normalización de flags a `false` para no-ensayos y bloqueo de conversiones hacia/desde `rehearsal` |
| `src/lib/attendance/mutations.ts` | MODIFY — guard inverso `rejectRehearsalEvent` en el flujo genérico |
| `src/app/events/event-form.tsx` / `new/page.tsx` | MODIFY — checkboxes Mañana/Tarde (solo ensayo) y defaults |
| `src/app/events/[id]/page.tsx` | MODIFY — render de `RehearsalAttendancePanel` para ensayos |
| `src/app/profile/page.tsx` / `src/app/members/[id]/page.tsx` | MODIFY — tile/ficha con % de participación en ensayos (`computeParticipationFromCounts`) |
| `tests/unit/lib/rehearsals-schema.test.ts` | CREATE — 11 tests de validación de esquema |
| `tests/unit/lib/rehearsals-stats.test.ts` | CREATE — 7 tests de estadísticas (null, 100 %, 0 %, redondeo 66.7, negativos) |
| `tests/unit/lib/rehearsals-mutations.test.ts` | CREATE — 16 tests de mutations (guards, fail-closed, upsert con conflict target, 23505, batch mixto y fallo con reporte por usuario) |
| `tasks/sprint-27-rehearsal-attendance.json` | CREATE — tarea del sprint |
| `docs/DATABASE.md` | MODIFY — filas de migración 0057 y 0058 en la tabla de migraciones |
| `docs/adr-sprint-27-rehearsal-attendance.md` | CREATE — este ADR |

### Tests

| Archivo | Tests |
|---|---|
| `tests/unit/lib/rehearsals-schema.test.ts` (CREATE) | 11 — valores y orden del enum, etiquetas en español, `isRehearsalSession`, UUIDs válidos/inválidos, `attended` requerido, batch vacío/no vacío, `clear` con sesión inválida |
| `tests/unit/lib/rehearsals-stats.test.ts` (CREATE) | 7 — `null` sin marcas, 100 %, 0 %, redondeo a 1 decimal (2/3 → 66.7), 5/8 → 62.5, recuento cero/negativo → `null` |
| `tests/unit/lib/rehearsals-mutations.test.ts` (CREATE) | 16 — guard de rol en las 3 mutations antes de tocar BD, sesión inválida, fail-closed ante error de lectura y evento ausente, evento no-ensayo, sesión no habilitada, upsert con actor como `marked_by` y conflict target triple, 23505 → mensaje amigable, batch válido/mixto/fallido con `Error for user <id>`, limpieza limitada a la sesión pedida |

**Verificado en local (2026-08-21):** `npx vitest run` → **1105 tests en 76 archivos, todos
pasando** (34 nuevos en los tres archivos anteriores); `npx tsc --noEmit` limpio;
`npx eslint . --max-warnings=0` limpio; `npx next build` sin errores. Security scan del
pipeline: CLEAN, 0 HIGH (estado `implemented` del task file).

---

## Referencias

- Task file: `tasks/sprint-27-rehearsal-attendance.json` (criterios de aceptación, DoD —
  incluye este ADR como entregable; dependencias: Sprint 5 — Asistencia y Ausencias, y
  Sprint 17 — Eventos).
- ADR-024 (Sprint 24 — Instrumentos): origen del patrón `requireManagementGuard` local en
  mutations reutilizado por `src/lib/rehearsals/mutations.ts`.
- ADR-002 (Sprint 2 — Roles): `MANAGEMENT_ROLES` (`super_admin`, `admin`, `board_member`,
  `event_manager` — `src/lib/auth/roles.ts`), conjunto espejado por
  `umsuka.is_management()` (0013) usado en la RLS de este sprint.
- Sprint 5 (Asistencia y Ausencias): tabla y flujo genéricos que este sprint complementa
  (y de los que se aísla mediante el guard inverso de D4).
- Sprint 17 (Eventos): `ATTENDANCE_ONLY_EVENT_TYPES`, patrón fail-closed
  `rejectAttendanceOnlyEvent` y módulo events (schema/mutations) extendidos aquí.
- Migraciones 0013 (`is_management`), 0018 (`update_updated_at_column`) y 0056
  (`instruments`, numeración previa): helpers y convenciones reutilizados.
- `docs/DATABASE.md`: filas 0057/0058 añadidas a la tabla de migraciones.
- Directivas globales: `docs/git-conventions.md` (rama
  `feature/sprint-27-rehearsal-attendance`, commits semánticos
  `feat(sprint-27)`/`fix(sprint-27)`; PR y escaneo security-champion gestionados por el
  Publisher en el cierre del sprint).
