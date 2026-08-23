# ADR-026: Sprint 26 — Buscador de Personas en Turnos (Shift Member Search)

**Status:** Accepted (Implementado) · **Date:** 2026-08-23 · **Sprint:** 26 ·
**Branch:** `feature/sprint-26-shift-member-search`

---

## Context

En la gestión de turnos de un evento (`/events/[id]`), el responsable de grupo (workgroup
lead) o el `super_admin` marca la asistencia recorriendo la **lista completa** de miembros
asignados a cada turno. En turnos con muchos asignados, localizar a una persona concreta
para marcarle la asistencia es lento y propenso a omisiones: no existe ninguna forma de
buscar por nombre dentro del turno.

Este sprint añade un **buscador en vivo** integrado en el propio panel de gestión del
turno: escribir nombre o apellido filtra los miembros asignados al turno en tiempo real y
permite **marcar/desmarcar la asistencia directamente desde los resultados**, sin salir de
la búsqueda.

Requisitos (criterios de aceptación del task file):

- El responsable de grupo puede buscar a cualquier miembro **asignado** al turno por
  nombre o apellido.
- Los resultados aparecen **en tiempo real** y permiten marcar la asistencia sin salir de
  la búsqueda.
- La búsqueda se combina con el **grupo de trabajo** (telas, barra, estandarte, limpieza):
  se puede filtrar por nombre, apellidos o grupo.
- El buscador respeta los **permisos existentes**: solo el lead del grupo del turno (o
  super admin según reglas actuales) puede marcar asistencia.
- Resultados navegables por **teclado** y compatibles con **lectores de pantalla**.
- Tests unitarios de la búsqueda e integración con el panel pasan.

Dependencias declaradas: **Sprint 8 (Shifts)** y **Sprint 12 (Asociación de Personas a
Turnos)**.

### Estado previo

- **Turnos (Sprint 8)**: módulo `src/lib/shifts/` y panel `ShiftManagementPanel`
  (crear/editar/borrar turnos, asignar miembros) en `/events/[id]`.
- **Asignaciones (Sprint 12)**: `umsuka.shift_assignments` con confirmación y
  `created_by`; es el universo de miembros de un turno.
- **Asistencia por grupos**: marcado existente vía `markWorkgroupAttendanceAction`
  (`src/app/events/[id]/workgroup-actions.ts`) → `markWorkgroupAttendance`
  (`src/lib/workgroups/mutations.ts`) con guard local `assertCanManageWorkgroup`
  (super_admin → todos los grupos; lead → solo su grupo exacto) y upsert idempotente sobre
  la constraint `UNIQUE (shift_id, user_id, workgroup)` de la migración 0018.
- **Precedentes reutilizados tal cual**:
  - Patrón **«sin migración SQL»** del Sprint 13: las queries se anclan en índices
    existentes y no se crea ningún archivo SQL nuevo.
  - Tratamiento del **lead de «ninguno» como rol sin permisos** (`canViewGroupStats`,
    Sprint 13): `isWorkgroupLead && workgroup !== "ninguno"` es la condición de scope real.
  - Server actions thin con `revalidatePath` solo en éxito (patrón del repo).
- Índices ya disponibles: `idx_shift_assignments_shift_id` (0004) e
  `idx_workgroup_attendance_shift_id` (0018).
- Última migración: 0058 (`rehearsal_attendance`, Sprint 27). Este sprint **no añade
  ninguna** (ver D7).
- Sin ningún buscador, filtro combinable ni paginación server-side en el panel de turnos.

---

## Decisión

### D1 — La búsqueda opera sobre miembros ASIGNADOS al turno (`shift_assignments ⨝ profiles`)

El universo de búsqueda son los miembros asignados al turno, nunca todo el directorio:

1. **Query 1**: `.from("shift_assignments").select("user_id").eq("shift_id", shiftId)` —
   anclada por el índice `idx_shift_assignments_shift_id` (0004); dedupe con `Set` y
   descarte de ids vacíos.
2. Si no hay asignados → página vacía **sin tocar** `profiles` ni `workgroup_attendance`.

No hay fallback a miembros no asignados: marcar asistencia a alguien fuera del turno
violaría las reglas del panel existente, así que el buscador hereda exactamente el mismo
universo que la lista que sustituye.

### D2 — Filtros combinables AND con escape ILIKE y neutralización del parser PostgREST

Texto libre **y** grupo de trabajo se combinan con AND sobre `profiles`:

| Filtro | Implementación |
|---|---|
| Texto libre | `.or(\`first_name.ilike.%{q}%,last_name.ilike.%{q}%\`)` — nombre **o** apellido |
| Grupo (opcional) | `activeWorkgroupSchema.nullish()` (`telas/barra/estandarte/limpieza`) → `.eq("workgroup", ...)` |

Dos helpers puros protegen la consulta:

- **`escapeIlikePattern(raw)`**: escapa `\` → `%` → `_` **en ese orden** (el backslash es
  él mismo el carácter de escape y debe ir primero) para que el término se trate como
  literal y `%`/`_` escritos por el usuario no actúen como comodines.
- **`stripPostgrestSeparatorChars(raw)`**: neutraliza comas y comillas dobles (sustitución
  por espacio) **antes** de construir el `.or(...)`: una coma dentro del valor ILIKE sería
  interpretada por PostgREST como separador de condiciones (→ HTTP 400) y las comillas
  abren/cierran el entrecomillado del valor. Así, «López, María» sigue funcionando como
  término de búsqueda.

Limitación aceptada: **ILIKE sin `unaccent`** — el matching de acentos es exacto
(`Jose` ≠ `José`). Documentada en el propio helper (ver Trade-offs).

### D3 — Paginación real server-side

La búsqueda pagina en servidor con recuento exacto, no carga el listado completo:

- Schema Zod `shiftMemberSearchSchema`: `query` requerida tras `trim` (1–100 caracteres),
  `page` default 1 con **clamp ≥ 1**, `pageSize` default 20 con **clamp [1, 50]**
  (`SHIFT_MEMBER_SEARCH_MAX_PAGE_SIZE`). Los valores no enteros se rechazan; los fuera de
  rango se degradan (estado stale del cliente nunca rompe).
- Ejecución: `.range(from, to)` con `from = (page-1)·pageSize` + `{ count: "exact" }`;
  orden estable `first_name ASC, last_name ASC`.
- Resultado tipado `ShiftMemberSearchPage { rows, total, page, pageSize, hasMore }`, con
  `hasMore = from + rows.length < total`.
- **Query vacía tras trim → página vacía sin tocar la BD**: el estado inicial del buscador
  es válido (no un error de Zod), por lo que el cortocircuito se evalúa **antes** del
  parse, que exige `min(1)` para búsquedas reales.

### D4 — Permisos fail-closed: identidad de sesión, scope de lead forzado, rechazo antes de BD

La autorización de la lectura replica las reglas de `assertCanManageWorkgroup` y corre
**antes de cualquier acceso a BD**:

1. La identidad viene siempre de **`requireAuthenticatedProfile()`** (perfil de la sesión,
   `src/lib/auth/session.ts`) — nunca de input del cliente.
2. **`isManagementRole(actor.role)`** (`super_admin`, `admin`, `board_member`,
   `event_manager`) → acceso completo; el filtro opcional de grupo se respeta tal cual.
3. **Lead real** (`isWorkgroupLead && workgroup !== "ninguno"`) → **scope forzado a su
   propio grupo**: si pide otro filtro de trabajo, se ignora («lead scope always wins»),
   espejo exacto de `assertCanManageWorkgroup` y de las reglas del panel.
4. Cualquier otro rol —incluido el lead de «ninguno», que no gestiona grupo real— →
   `AuthorizationError` («No tienes permisos para buscar miembros en este turno.») antes
   de instanciar query alguna (evita además un absurdo `.eq("workgroup", "ninguno")`).

La **escritura no duplica autorización**: el toggle delega en `markWorkgroupAttendanceAction`
existente, que vuelve a validar con `assertCanManageWorkgroup` y queda limitado por RLS.
El lado presentación completa el cuadro: `page.tsx` computa `manageableWorkgroups` con las
mismas reglas (super_admin → todos; lead real → `[suGrupo]`; resto → `[]`), lo pasa como
prop opcional `attendanceContext` al panel, y el buscador solo se renderiza cuando el
viewer puede gestionar al menos un grupo; `canEditRow(row)` oculta los controles de
cualquier fila fuera de ese conjunto (lectura pura).

### D5 — Toggle desde resultados: delegación en `markWorkgroupAttendanceAction`

Marcar/desmarcar desde un resultado **reutiliza la mutation existente** sin duplicar nada:

- Upsert idempotente sobre `UNIQUE (shift_id, user_id, workgroup)` (0018) vía
  `{ onConflict: "shift_id, user_id, workgroup" }`: remarcar actualiza, jamás duplica.
- **`marked_by` se estampa server-side** con el actor autenticado; un payload manipulado
  no puede atribuir la marca a otro perfil.
- `hoursWorked` siempre `null` en este flujo (el cálculo de horas efectivas usa la
  duración del turno, patrón Sprint 13).
- **Caso barra**: el schema exige `barraTask`, así que la UI obliga a elegir tarea
  (**cocina/bebidas**) con radios inline antes de habilitar «Marcar presente».
- `revalidatePath("/events/[id]", "page")` solo en éxito (dentro de la action existente).

### D6 — UX en vivo: debounce, carreras, rollback fiel y accesibilidad

Componente cliente `ShiftMemberSearch` (combobox pattern):

- **Debounce de 300 ms** (`SEARCH_DEBOUNCE_MS`) sobre el término crudo.
- **Contador monótono `requestIdRef`** que invalida respuestas obsoletas: cada nueva
  búsqueda incrementa el contador y las respuestas tardías se descartan. Al vaciar la
  query (borrado manual o tecla **Escape**) también se incrementa, de modo que una
  respuesta en vuelo no puede repoblar la lista ya limpiada. Necesario porque las server
  actions no se pueden abortar desde el cliente.
- **Toggle optimista con rollback fiel**: al fallar el guardado se restaura el valor
  anterior **verbatim** — `attended = null` («Sin marcar») no se degrada a `false`
  («Ausente»).
- **ARIA completo**: input con `role="combobox"`, `aria-autocomplete="list"`,
  `aria-expanded`, `aria-controls`, `aria-activedescendant` y `aria-busy`; lista con
  `role="listbox"` y opciones con `role="option"` + `aria-selected`; contador con
  `role="status"` + `aria-live="polite"` («Buscando…», «Escribe para buscar…», «N
  resultado(s)»); errores con `role="alert"`.
- **Teclado**: `↑`/`↓` mueven el resaltado, `Enter` ejecuta la acción primaria de la fila
  (toggle simple o guardar barra), `Escape` limpia la búsqueda.
- Paginador Anterior/Siguiente deshabilitados según `page`/`hasMore`; cualquier cambio de
  término o filtro resetea a la página 1.

### D7 — Sin migración SQL: queries ancladas por `shift_id` sobre índices existentes

No se crea ningún archivo SQL nuevo (segundo precedente del Sprint 13):

- Las tres queries se anclan por `shift_id` usando los índices ya creados:
  `idx_shift_assignments_shift_id` (0004) para el universo de asignados e
  `idx_workgroup_attendance_shift_id` (0018) para el mapa de asistencia.
- El filtro de texto ILIKE sobre `profiles` queda **acotado por
  `.in("id", userIds)`**: solo se examinan los perfiles de los asignados al turno
  (decenas), nunca la tabla completa.
- `pg_trgm` / `unaccent` **descartados** por alcance/volumen: exigirían habilitar
  extensiones y crear índices GIN (migraciones nuevas) para un universo que ya está
  acotado por diseño (D1). Ver Alternativas.

### D8 — Tests: 55 nuevos en 4 archivos, suite completa en verde

| Archivo | Tests | Cobertura |
|---|---|---|
| `tests/unit/lib/shift-search-schema.test.ts` | 21 | `escapeIlikePattern` (backslash primero, `%`, `_`, combinados, texto plano) y `shiftMemberSearchSchema` (defaults/clamps de paginación, trim, min/max de query, UUID, enum de workgroup, no enteros) |
| `tests/unit/lib/shift-search-queries.test.ts` | 14 | Autorización fail-closed (rol sin permiso sin tocar BD; lead de «ninguno» sin scope), cortocircuito de query vacía, happy path (3 queries + merge), escape ILIKE en el `.or()`, `range(from,to)` y `hasMore`, scoping de lead vs management, caso degenerado sin asignados y propagación de errores de BD |
| `tests/unit/lib/shift-search-action.test.ts` | 8 | Action fail-closed (sin sesión, rol sin permiso, lead acotado, management completo), input inválido, contrato read-only (**nunca** `revalidatePath`), mapeo de error inesperado a fallo genérico |
| `tests/unit/components/shift-member-search.test.tsx` | 12 | Debounce ~300 ms, render por fila + live region, arranque en blanco, toggle vía action + refresh, rollback optimista, caso barra (tarea requerida/enviada), teclado ↑/Enter/Escape, respuesta obsoleta tras Escape, rollback fiel de «Sin marcar», paginador |

**Verificado en local (2026-08-23):** `npx vitest run` → **1160 tests, todos pasando**
(55 nuevos en los cuatro archivos anteriores); `npx tsc --noEmit` limpio;
`npx eslint . --max-warnings=0` limpio; `npx next build` sin errores. Security scan del
pipeline: CLEAN, 0 HIGH.

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| **Búsqueda fuzzy con `pg_trgm` + `unaccent`** (extensión + índices GIN) | Exige migraciones nuevas (habilitar extensiones, indexar `first_name`/`last_name`) y mantenimiento de índices para un universo que D1 ya deja acotado a los asignados de un turno (decenas de filas). El coste operativo no compensa; la limitación de acentos queda documentada como trade-off aceptado. |
| **RPC `SECURITY DEFINER` única** que devuelva la página ya ensamblada | El repo no usa RPCs de escritura para estos flujos y las existentes son de solo lectura/puntuales; tres queries batched simples con merges en JS cubren el caso sin añadir superficie `SECURITY DEFINER`. |
| **Buscar sobre todos los `profiles`** (sin acotar por asignación) | Rompería la semántica «miembros DEL turno»: el buscador existe para marcar asistencia, y marcar a alguien no asignado violaría las reglas del panel. Además multiplicaría el volumen escaneado y obligaría a paginar sobre toda la tabla. |
| **Filtrar en cliente** el listado ya cargado (`getAllWorkgroupMembers`/`getAvailableMembers`) | Cargaría el listado completo aunque se busque a una persona, sin total real ni paginación, y duplicaría la lógica de filtrado/scoping en cliente y servidor con riesgo de divergencia de permisos (el scoping de lead debe decidirse en servidor). |
| **Ruta separada** `/events/[id]/search` con componente autónomo | Fragmenta el flujo: el requisito es marcar «sin salir de la búsqueda». La integración inline en `ShiftManagementPanel` mantiene contexto de turno y asistencia en una sola pantalla. |

---

## Edge cases manejados

| Escenario | Comportamiento |
|---|---|
| Query vacía o solo espacios | Página vacía sin tocar la BD; además se invalida cualquier respuesta en vuelo (D3/D6) |
| Escape (o borrado) durante una búsqueda en curso | `requestIdRef++` impide que la respuesta obsoleta repueble la lista limpia (D6) |
| Respuesta antigua llega tras una pulsación nueva | Descartada por comparación con el contador monótono (D6) |
| Término con comodines ILIKE (`%`, `_`, `\`) | Escapados por `escapeIlikePattern` → coincidencia literal (D2) |
| Término con coma o comillas dobles («López, María») | Neutralizados a espacio antes del `.or(...)` → imposible el HTTP 400 del parser PostgREST (D2) |
| `page`/`pageSize` fuera de rango por estado stale | Clamp Zod (`page ≥ 1`, `pageSize ∈ [1, 50]`); valores no enteros → rechazo explícito (D3) |
| Query > 100 caracteres | Rechazada por el schema («La búsqueda no puede superar los 100 caracteres.») |
| Turno sin asignados | Página vacía tras la primera query, sin consultar `profiles` ni asistencia (D1) |
| Lead pide filtrar por otro grupo | Scope forzado a su grupo: el filtro solicitado se ignora, nunca amplia (D4) |
| Lead de «ninguno» u otro rol sin permisos | `AuthorizationError` antes de cualquier acceso a BD (D4) |
| Toggle rechazado en servidor | Rollback optimista fiel: «Sin marcar» (`null`) no se convierte en «Ausente» (D6) |
| Barra sin tarea elegida | Botón deshabilitado hasta elegir cocina/bebidas; el schema de la mutation exige `barraTask` (D5) |
| Fila de un grupo no gestionable por el viewer | Se muestra pero sin controles de edición (solo lectura, D4) |
| Viewer sin grupos gestionables | El buscador no se renderiza en absoluto (`manageableWorkgroups.length > 0`) |
| Error de BD en cualquiera de las 3 queries | Propagado y mapeado en la action a «No se pudo completar la búsqueda.» con log server-side |

---

## Consecuencias

### Positivas

- **Marcar asistencia puntual sin recorrer listas**: el lead/super admin localiza a una
  persona en segundos y la marca desde el propio resultado; el flujo existente por grupo
  permanece intacto para el marcado masivo.
- **Cero lógica de autorización duplicada**: la lectura replica (con tests propios) las
  reglas de `assertCanManageWorkgroup` y la escritura delega íntegramente en
  `markWorkgroupAttendanceAction` (+ RLS). Una sola fuente de verdad para «quién puede
  marcar».
- **Paginación honesta**: `total` exacto (`count: "exact"`), ventana `.range()` en
  servidor y `hasMore` derivado; el cliente nunca carga el turno completo.
- **Accesibilidad de primera clase**: patrón combobox/listbox completo, live region y
  navegación por teclado, verificados por tests de componentes.
- **Sin migraciones**: riesgo de esquema nulo; el deploy es solo de aplicación y las
  queries aprovechan índices que ya existían.
- **Suite nueva verde**: 55 tests (21 schema + 14 queries + 8 action + 12 componente),
  incluidos los casos de carrera (respuestas obsoletas) y rollback fiel.

### Seguridad (defensa en profundidad)

- **Identidad solo de sesión**: `requireAuthenticatedProfile()` resuelve el actor; ningún
  campo del input del cliente puede suplantar identidad ni ampliar scope.
- **Fail-closed antes de BD**: roles sin permiso reciben `AuthorizationError` sin que se
  ejecute query alguna; el scope del lead se fuerza en servidor aunque el cliente manipule
  el filtro de grupo.
- **Escritura por el camino ya endurecido**: el toggle pasa por `markWorkgroupAttendance`
  (Zod + `assertCanManageWorkgroup` + evento attendance-only check + RLS + upsert con
  conflict target); `marked_by` inmutable desde el cliente.
- **Superficie nueva mínima**: la única action nueva es de **lectura**, sin
  `revalidatePath`, con errores acotados en español (los errores crudos de BD quedan en el
  log del servidor).
- Security scan del pipeline (security-champion): **CLEAN — 0 HIGH**.

### Trade-offs aceptados / hallazgos conocidos

1. **ILIKE sin `unaccent`** (D2): `Jose` no encuentra `José`. Aceptado por el volumen del
   dominio y documentado en el propio helper; introducir `unaccent` requeriría extensión +
   migración (descartadas en D7).
2. **Tres queries batched por búsqueda** (asignaciones → página de perfiles → asistencia,
   merge en JS): suficiente para decenas de asignados por turno; no es la solución para
   miles de filas, volumen que no existe en el dominio (patrón merge-en-JS del repo).
3. **Server actions no abortables**: el cliente descarta respuestas obsoletas vía contador
   monótono, pero el trabajo del servidor de una petición superseded puede completarse.
   Aceptado: la acción es de lectura barata y el debounce de 300 ms reduce el solape.
4. **Latencia percibida del debounce** (300 ms): deliberada, evita inundar el servidor por
   pulsación; el estado «Buscando…» se anuncia por la live region.
5. **Lectura sin revalidar** (contrato read-only): tras marcar asistencia es la action de
   escritura existente quien revalida `/events/[id]`; la acción de búsqueda nunca toca la
   caché del router.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `src/lib/shifts/search.ts` | CREATE — `shiftMemberSearchSchema` (Zod con clamps), constantes de paginación, helpers puros `escapeIlikePattern`/`stripPostgrestSeparatorChars`, tipos `ShiftMemberSearchRow`/`ShiftMemberSearchPage` y `searchShiftMembers` (fail-closed, 3 queries batched, paginación server-side) |
| `src/app/events/[id]/shift-member-search-actions.ts` | CREATE — `searchShiftMembersAction` read-only: `requireAuthenticatedProfile` + delegación en la query, `AuthorizationError` mapeado a mensaje controlado, resto a error genérico con log server-side, sin `revalidatePath` |
| `src/app/events/[id]/shift-member-search.tsx` | CREATE — componente cliente combobox: debounce 300 ms, contador `requestIdRef`, toggle optimista con rollback fiel, caso barra inline, ARIA (combobox/listbox/option, live polite, alert), teclado ↑/↓/Enter/Escape y paginador |
| `src/app/events/[id]/shift-management-panel.tsx` | MODIFY — interfaz `AttendanceContext` + prop opcional `attendanceContext`; render condicional de `ShiftMemberSearch` bajo cada turno solo si el viewer gestiona algún grupo |
| `src/app/events/[id]/page.tsx` | MODIFY — computa `manageableWorkgroups` espejo de `assertCanManageWorkgroup` (super_admin → todos; lead real → su grupo; resto → []) y pasa `attendanceContext` al panel |
| `tests/unit/lib/shift-search-schema.test.ts` | CREATE — 21 tests de esquema y helpers puros |
| `tests/unit/lib/shift-search-queries.test.ts` | CREATE — 14 tests de autorización, cortocircuitos, paginación, scoping y errores de BD |
| `tests/unit/lib/shift-search-action.test.ts` | CREATE — 8 tests de la action fail-closed y su contrato read-only |
| `tests/unit/components/shift-member-search.test.tsx` | CREATE — 12 tests de UX (debounce, render, toggles, barra, teclado, carreras, rollback, paginación) |
| `docs/adr-sprint-26-shift-member-search.md` | CREATE — este ADR |

### Tests

| Archivo | Tests |
|---|---|
| `tests/unit/lib/shift-search-schema.test.ts` (CREATE) | 21 — escape de `\`/`%`/`_` (orden y casos combinados), defaults y clamps de `page`/`pageSize`, trim y límites 1–100 de la query, UUID de turno, `workgroup` nullable/fuera de enum, rechazo de no enteros |
| `tests/unit/lib/shift-search-queries.test.ts` (CREATE) | 14 — AuthorizationError sin tocar BD, lead «ninguno» sin scope, query en blanco sin queries, secuencia asignaciones→profiles→attendance con merge, escape ILIKE en el `.or()`, `range(from,to)`/`hasMore`, lead forzado a su grupo, management con/sin filtro, turno vacío, propagación de errores de las 3 queries |
| `tests/unit/lib/shift-search-action.test.ts` (CREATE) | 8 — sin sesión, rol sin permiso, lead acotado, management completo, input inválido, ausencia garantizada de `revalidatePath`, error inesperado → genérico, propagación de `AuthorizationError` |
| `tests/unit/components/shift-member-search.test.tsx` (CREATE) | 12 — debounce con reset de ventana, fila con badges y estado, live region, arranque en blanco sin llamar a la action, toggle + refresh, rollback con error de servidor, barra exige tarea y envía `barraTask`, teclado ↑/Enter/Escape, obsoleto tras Escape, rollback de «Sin marcar», paginador habilitado/deshabilitado |

**Verificado en local (2026-08-23):** `npx vitest run` → **1160 tests, todos pasando**
(55 nuevos); `npx tsc --noEmit` limpio; `npx eslint . --max-warnings=0` limpio;
`npx next build` sin errores. Security scan del pipeline: CLEAN, 0 HIGH (estado
`implemented` del task file al cerrar la implementación).

---

## Referencias

- Task file: `tasks/sprint-26-shift-member-search.json` (criterios de aceptación, DoD —
  incluye este ADR como entregable; dependencias: Sprint 8 — Shifts, y Sprint 12 —
  Asociación de Personas a Turnos).
- ADR-008 (Sprint 8 — Turnos): módulo `src/lib/shifts/` y panel de gestión de
  `/events/[id]` donde se integra el buscador.
- ADR-012 (Sprint 12 — Asociación de Personas a Turnos): `shift_assignments`, universo de
  miembros sobre el que opera la búsqueda (D1).
- ADR-013 (Sprint 13 — Estadísticas por Grupo): precedentes reutilizados — patrón «sin
  migración SQL» sobre índices existentes y tratamiento del lead de «ninguno» como rol sin
  permisos (`canViewGroupStats`), replicado en `searchShiftMembers` (D4/D7).
- Migraciones 0004 (`idx_shift_assignments_shift_id`) y 0018 (`workgroup_attendance`:
  `UNIQUE (shift_id, user_id, workgroup)`, `idx_workgroup_attendance_shift_id`):
  índices/constraints consumidos sin modificación (D5/D7).
- Directivas globales: `docs/git-conventions.md` (rama
  `feature/sprint-26-shift-member-search`, commits semánticos
  `feat(sprint-26)`/`fix(sprint-26)` ya aplicados en la rama; PR y escaneo
  security-champion gestionados por el Publisher en el cierre del sprint).
