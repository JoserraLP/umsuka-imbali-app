# ADR-018: Sprint 17b — Eventos de Reunión y Carnaval: Solo Asistencia (sin Turnos ni Ausencias)

**Status:** Accepted · **Date:** 2026-08-15

---

## Context

Tras el Sprint 17, la página de detalle de evento mostraba la gestión de turnos para **todos** los tipos de evento (comentario histórico `shown for all event types` en `page.tsx`) y el panel de ausencias para todo lo que no fuera `work_shift`. Eso significaba que un evento `meeting` (reunión) o `carnival` (carnaval) podía tener turnos, asignaciones, asistencia por grupo de trabajo y ausencias — operativa pensada para eventos de trabajo que no tiene sentido en una reunión o un carnaval.

La regla nueva es categórica: **para `meeting` y `carnival`, la única operativa es la asistencia** (marcar quién asistió, inscripción y comentarios existentes intactos). Los turnos (`umsuka.shifts` + `shift_assignments` + `workgroup_attendance` asociada) y las ausencias (`umsuka.absences`) se eliminan en **tres capas**: UI (paneles ocultos), servidor (validación en mutations/server actions) y datos (migración de limpieza de los datos legacy). Los eventos `general` y `work_shift` conservan toda su funcionalidad actual sin cambios.

Implementado en la rama `feature/sprint-17-events-enhancement` (siguiendo `docs/git-conventions.md`). **Sin PR todavía:** los cambios están en el working tree de la rama, pendientes del pipeline estándar (commit/PR/escaneo security-champion); la tarea `tasks/sprint-17b-attendance-only-meeting-carnival.json` figura con status `security-cleared`.

### Restricciones heredadas

- **Las políticas RLS no conocen la regla por tipo de evento** (migraciones 0013/0032): `shifts_insert/update/delete_management_or_lead`, `shift_assignments_insert/delete_management_or_lead` y `absences_*` siguen permitiendo a management operar sobre eventos de cualquier tipo. **No se modifican en este sprint** — el guard de aplicación es la defensa principal (divergencia documentada en la sección de deuda).
- **`umsuka.absences.event_id` no tiene `ON DELETE CASCADE`**: el `DELETE` explícito de ausencias en la migración 0048 es obligatorio, no puede apoyarse en una cascada.
- **La tabla `umsuka.attendance` no se toca**: es la única operativa restante para `meeting`/`carnival`; la migración la excluye deliberadamente.
- **No se cambia el esquema de tablas**: `shifts`, `shift_assignments`, `workgroup_attendance` y `absences` siguen existiendo para `general`/`work_shift`.
- La regla de ausencias heredada «todo lo que no es `work_shift`» se reescribe como «solo `general`»: el resultado es equivalente para `work_shift` (la UI ya no las mostraba) y excluye `meeting`/`carnival`.

---

## Decisión

### 1. Regla de negocio: solo asistencia para `meeting`/`carnival`

| Tipo de evento | Turnos | Asignaciones | Asistencia por grupo | Ausencias | Asistencia |
|---|---|---|---|---|---|
| `general` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `work_shift` | ✅ | ✅ | ✅ | ✅* | ✅ |
| `meeting` | ❌ | ❌ | ❌ | ❌ | ✅ |
| `carnival` | ❌ | ❌ | ❌ | ❌ | ✅ |

\* Las ausencias siguen **permitidas a nivel de servidor** para `work_shift` (los guards solo rechazan `meeting`/`carnival`), pero la UI nunca las ha mostrado para `work_shift` — comportamiento heredado que no cambia.

El enforcement se hace en tres capas: UI (ocultar paneles y evitar lecturas inútiles), servidor (guards en todas las mutations, rechazo con mensaje claro) y datos (migración 0048 que elimina el legacy). El servidor es la única barrera real frente a clientes hostiles; la RLS queda como backstop de rol, no de tipo (ver deuda).

### 2. Helper de dominio — `src/lib/events/policy.ts`

Nuevo módulo hoja del **dominio del evento**, deliberadamente colocado en `lib/events` (no en `lib/shifts` ni `lib/absences`): la regla «qué tipos son solo asistencia» pertenece al evento, y colocarla en cualquiera de los otros módulos crearía ciclos de import (tanto `shifts/mutations.ts` como `absences/mutations.ts` y `workgroups/mutations.ts` necesitan la misma regla). `events/policy.ts` no importa de ninguno de ellos.

- `ATTENDANCE_ONLY_EVENT_TYPES = ["meeting", "carnival"] as const` — única fuente de verdad para el conjunto.
- `isAttendanceOnlyEventType(eventType)` — **predicado puro** (unit-testable sin mocks): `true` solo para `meeting`/`carnival`; `false` para `null`, `undefined`, tipos desconocidos y `general`/`work_shift`.
- `getEventType(eventId)` — lectura async de `event_type` desde BD; devuelve `null` cuando el evento no existe (o no es visible para el actor), lo que permite **fail-closed**.
- `rejectAttendanceOnlyEvent(eventId, unavailableMessage)` — devuelve `null` (permitido) cuando el evento existe y NO es solo-asistencia; `"Evento no encontrado."` cuando no existe (fail-closed); y el mensaje de indisponibilidad cuando es `meeting`/`carnival`.
- Mensajes de error canónicos: `SHIFTS_UNAVAILABLE_MESSAGE` («Los turnos no están disponibles para este tipo de evento.»), `ABSENCES_UNAVAILABLE_MESSAGE` («Las ausencias no están disponibles para este tipo de evento.») y `WORKGROUP_ATTENDANCE_UNAVAILABLE_MESSAGE` («La asistencia por grupo de trabajo no está disponible para este tipo de evento.»).

### 3. Guards en el servidor (defensa en profundidad)

**`src/lib/shifts/mutations.ts`** — `createShift`, `updateShift`, `deleteShift`:

- `createShift`: guard sobre el `eventId` del input (única fuente posible: el turno aún no existe).
- `updateShift` / `deleteShift`: leen primero el turno de BD (`"Turno no encontrado."` si no existe) y usan el **event_id REAL del turno como fuente de verdad** tanto para el guard de tipo como para el auth check. Incluye el **fix del auth check**: `assertCanManageShifts(shift.event_id)` ahora recibe el evento real del turno (leído de BD) en lugar de depender del `eventId` que llegue del cliente — un cliente no puede validar contra el tipo de un evento distinto al del turno que toca.

**`src/lib/shifts/assignments.ts`** — `canAssignToShift` + `assertCanAssign`:

- `canAssignToShift` (helper puro que espeja las políticas RLS `shift_assignments_insert/delete_management_or_lead`): añade al inicio `if (event && isAttendanceOnlyEventType(event.eventType)) return false;` — la asignación queda **bloqueada para TODOS, management incluido**.
- `assertCanAssign` (usado por `assignMemberToShift` y `unassignMemberFromShift`): lee el turno y su evento de BD y devuelve `SHIFTS_UNAVAILABLE_MESSAGE` para eventos solo-asistencia (mensaje de política en lugar del error genérico de permisos).
- Caso adicional verificado por tests: un lead no puede asignar ni siquiera en eventos `meeting`/`carnival` que él haya creado (la excepción de lead solo aplica a `work_shift`).

**`src/lib/absences/mutations.ts`** — `requestAbsence`, `justifyAbsence`, `deleteAbsence`:

- `requestAbsence`: guard sobre el `eventId` del input (`userId` sigue viniendo solo de la sesión autenticada, anti-suplantación).
- `justifyAbsence` / `deleteAbsence`: fetch del `event_id` REAL de la ausencia desde BD (`"Ausencia no encontrada."` si no existe) como fuente de verdad, antes del guard de tipo.

**`src/lib/workgroups/mutations.ts`** — `markWorkgroupAttendance`, `updateWorkgroupAttendance`:

- `markWorkgroupAttendance`: guard sobre el `shift.event_id` real leído de BD (única entrada que puede **crear** registros de asistencia por grupo).
- `updateWorkgroupAttendance`: **deliberadamente SIN guard** — deuda documentada en el propio código: tras la migración 0048 ya no existen registros de asistencia por grupo para turnos de `meeting`/`carnival`, y la UI solo renderiza el panel para eventos con turnos, por lo que esta mutación legacy es inalcanzable para eventos solo-asistencia. La guarda vive en `markWorkgroupAttendance`, el único punto capaz de crear datos nuevos.

### 4. UI — `src/app/events/[id]/page.tsx`

- `canHaveShifts = !isAttendanceOnlyEventType(event.eventType)` y `canHaveAbsences = event.eventType === "general"` (equivalente a la regla previa `!isWorkShift` menos `meeting`/`carnival`).
- **Fetches condicionados, sin lecturas inútiles**: `getEventShifts`/`getAvailableMembers` solo si `canHaveShifts`; `getEventAbsences`/`getUserAbsenceForEvent` solo si `canHaveAbsences`; `getWorkgroupAttendanceByShift` depende de `firstShift`, que ya no existe para `meeting`/`carnival`.
- **Paneles ocultos** para `meeting`/`carnival`: `ShiftManagementPanel` gated por `canHaveShifts`; `WorkgroupAttendancePanel` por `canHaveShifts && canViewWorkgroupPanel && firstShift`; `AbsencePanel` por `canHaveAbsences`.
- **`AttendancePanel` intacto** (condición `canManage && !isWorkShift` sin cambios): la asistencia es la única operativa restante. Inscripción (`RegistrationPanel`) y comentarios intactos.

### 5. Migración de limpieza — `20260101004800_cleanup_attendance_only_events.sql`

Cuatro `DELETE` **acotados** con `using … join umsuka.events` y filtro `event_type in ('meeting', 'carnival')`, en **orden de dependencias** (hijos antes que padres):

1. `shift_assignments` (hijos de `shifts`) — join contra `shifts`/`events`.
2. `workgroup_attendance` (hijos de `shifts`) — mismo patrón, antes de borrar los turnos.
3. `shifts` — join contra `events`.
4. `absences` — join contra `events`; **el DELETE explícito es obligatorio** porque `absences.event_id` no tiene cascada.

- **`attendance` NO se toca** (única operativa restante, comentado en la cabecera).
- Sin wrapper de transacción: cada statement es atómico por sí mismo y el orden de dependencias garantiza que no se violan FKs (documentado en la cabecera de la migración).
- **Nota operacional**: es una migración destructiva e irreversible (DELETEs puros). Antes de aplicarla en producción conviene respaldo de las tablas afectadas y dimensionado del volumen de filas a eliminar por cada `DELETE`.

---

## Deuda conocida y riesgos

### 1. Edge case MEDIUM (QA/security): `updateEvent` permite convertir `general` → `meeting`/`carnival` dejando datos huérfanos

`src/lib/events/mutations.ts` — `updateEvent` permite a management cambiar el `event_type` de un evento `general` (que puede tener turnos, asignaciones, asistencia por grupo y ausencias) a `meeting`/`carnival` **sin limpiar los datos hijos**. La única conversión bloqueada es desde `work_shift` («No puedes cambiar el tipo de un evento de tipo trabajo.»); la conversión `general` → solo-asistencia no tiene guard ni limpieza.

Consecuencia: quedan **huérfanos** — turnos/asignaciones/ausencias de un evento que ahora es solo-asistencia. Son **visibles** en `/profile/shifts` (vía `getMyAssignedShifts`) y en las estadísticas de grupo (`workgroups-stats`), y quedan **bloqueados para borrado** por los nuevos guards (los turnos/ausencias de `meeting`/`carnival` no se pueden actualizar ni borrar ni siquiera por management).

**Decisión pendiente para Sprint 18** (no resuelta en este sprint): bloquear la conversión a `meeting`/`carnival` cuando el evento tiene datos hijos, o limpiarlos transaccionalmente dentro de `updateEvent`.

### 2. Divergencia app vs RLS

Las políticas RLS de `shifts`, `shift_assignments`, `workgroup_attendance` y `absences` siguen permitiendo a management insertar/borrar en eventos de **cualquier tipo** (no filtran por `event_type`). El guard de aplicación es la **defensa principal**; la RLS queda como backstop de rol, no de tipo. Endurecimiento opcional futuro: políticas con filtro de tipo de evento (requiere reescribir las políticas existentes, fuera del alcance de este sprint).

### 3. `updateWorkgroupAttendance` sin guard de solo-asistencia

Documentada en el código: inalcanzable para eventos solo-asistencia tras la migración 0048 (sin registros que actualizar) y la UI no la expone. Queda como deuda por si el riesgo #1 (datos huérfanos vía `updateEvent`) reintroduce registros en el futuro.

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| Aplicar la regla solo en UI (ocultar paneles) | La UI es cosmética: un cliente hostil podría crear turnos/ausencias para `meeting`/`carnival` directamente contra la API; los guards en mutations/server actions son el enforcement real (los tests validan el rechazo sin pasar por la UI). |
| Aplicar la regla en RLS (políticas con filtro `event_type`) | Las políticas actuales son por rol y no conocen el tipo de evento; reescribir RLS en este sprint amplía la superficie de cambio y el guard de aplicación ya cubre todas las rutas del servidor. Queda como deuda documentada (la RLS sigue siendo backstop de rol). |
| No ejecutar la migración de limpieza (dejar el legacy) | Los datos de `meeting`/`carnival` quedarían inaccesibles desde la UI pero seguirían contando en consultas y stats y romperían el invariante «solo asistencia»; la limpieza en orden de dependencias es la única forma de restaurarlo. |
| Borrar ausencias apoyándose en cascade | No existe `ON DELETE CASCADE` en `absences.event_id`; el `DELETE` explícito con JOIN es obligatorio. |
| Envolver la migración en una transacción | El comentario de la migración documenta que no hace falta: cada statement es atómico por sí mismo y el orden de dependencias evita violaciones de FK punto a punto. |
| Colocar los helpers en `lib/shifts` o `lib/absences` | Ambas tendrían que importar la misma regla y una de las dos crearía un ciclo (`shifts` ↔ `absences`); la regla pertenece al dominio del evento → `lib/events` como módulo hoja sin imports de vuelta. |
| Añadir guard a `updateWorkgroupAttendance` | Inalcanzable post-migración (sin registros que actualizar) y la UI no lo expone; añadir el guard sería ruido sin camino de ejecución. Queda como deuda monitorizada (riesgo #1). |

---

## Consecuencias

### Positivas

- Regla de negocio clara y consistente en las tres capas: `meeting`/`carnival` = solo asistencia; `general`/`work_shift` intactos.
- Guards **fail-closed** en el servidor: evento inexistente → «Evento no encontrado.» (nunca se permite por defecto).
- **Fuente de verdad real** en update/delete de turnos y ausencias (evento leído de BD, no del input del cliente), incluido el fix del auth check `assertCanManageShifts(shift.event_id)` en `shifts/mutations.ts`.
- Sin lecturas inútiles en la página de detalle: las queries de turnos/ausencias solo se ejecutan para tipos que pueden tenerlas.
- Migración 0048 ordenada por dependencias, acotada por JOIN con `events`, sin tocar `attendance`; el `DELETE` explícito de ausencias cubre la falta de cascade.
- Suite completa: **585 tests en 42 archivos pasando** (`npx vitest run`), `tsc --noEmit` y `eslint . --max-warnings=0` limpios (verificados en local).

### Seguridad (defensa en profundidad)

- El rechazo de turnos/ausencias/asistencia por grupo para `meeting`/`carnival` ocurre en el **servidor** (mutations), no solo en la UI: la capa de aplicación es la defensa principal frente a clientes hostiles.
- `canAssignToShift` bloquea la asignación para **todos** (management incluido) en eventos solo-asistencia; el guard es previo a cualquier insert/delete.
- La verificación del tipo de evento usa siempre el **evento real del registro** (de BD) en las mutaciones sobre registros existentes, evitando spoofing del `eventId` por el cliente.
- La RLS sigue siendo el backstop de roles (defensa en profundidad clásica), aunque sin conocimiento del tipo de evento (divergencia documentada).
- **Security scan PASS sin hallazgos HIGH** (tarea con status `security-cleared`).

### Riesgos / pendientes

- **Edge case MEDIUM de `updateEvent`** (conversión `general` → `meeting`/`carnival` con datos hijos huérfanos): decisión pendiente para Sprint 18 (bloquear la conversión o limpiar transaccionalmente). Ver sección propia.
- **Divergencia app vs RLS**: las políticas siguen permitiendo operación de management en eventos de cualquier tipo; endurecimiento opcional futuro en RLS.
- **`updateWorkgroupAttendance` sin guard** de solo-asistencia (deuda documentada; inalcanzable post-0048).
- **Nota operacional de la migración 0048**: destructiva e irreversible — respaldo y dimensionado antes de aplicar en producción.
- **Sin PR todavía**: cambios en el working tree de `feature/sprint-17-events-enhancement`, pendientes del pipeline estándar (commit siguiendo `docs/git-conventions.md`, PR con plantilla, escaneo de seguridad final).

---

## Archivos

| Archivo | Cambio |
|---|---|
| `src/lib/events/policy.ts` | CREATE — helpers de dominio: `ATTENDANCE_ONLY_EVENT_TYPES`, `isAttendanceOnlyEventType`, `getEventType`, `rejectAttendanceOnlyEvent`, mensajes canónicos |
| `src/lib/shifts/mutations.ts` | MODIFY — guards en `createShift`/`updateShift`/`deleteShift`; fuente de verdad = `event_id` real del turno; fix del auth check `assertCanManageShifts(shift.event_id)` |
| `src/lib/shifts/assignments.ts` | MODIFY — `canAssignToShift` devuelve `false` para solo-asistencia (todos, management incluido); `assertCanAssign` devuelve `SHIFTS_UNAVAILABLE_MESSAGE` |
| `src/lib/absences/mutations.ts` | MODIFY — guards en `requestAbsence`/`justifyAbsence`/`deleteAbsence` (fetch del `event_id` real en justify/delete) |
| `src/lib/workgroups/mutations.ts` | MODIFY — guard en `markWorkgroupAttendance`; `updateWorkgroupAttendance` sin guard (deuda documentada en el código) |
| `src/app/events/[id]/page.tsx` | MODIFY — `canHaveShifts`/`canHaveAbsences`; fetches condicionados sin lecturas inútiles; paneles ocultos para `meeting`/`carnival`; `AttendancePanel` intacto |
| `supabase/migrations/20260101004800_cleanup_attendance_only_events.sql` | CREATE — 4 DELETEs acotados por tipo de evento, en orden de dependencias; `attendance` intacta |
| `src/lib/shifts/__tests__/assignments.test.ts` | MODIFY — +4 casos de `canAssignToShift` para solo-asistencia |
| `tests/unit/lib/events-policy.test.ts` | CREATE — tests del helper de dominio |
| `tests/unit/lib/shifts-mutations.test.ts` | CREATE — tests de guards de turnos |
| `tests/unit/lib/absences-mutations.test.ts` | CREATE — tests de guards de ausencias |
| `tests/unit/lib/workgroups-mutations.test.ts` | CREATE — tests de guard de asistencia por grupo |
| `tasks/sprint-17b-attendance-only-meeting-carnival.json` | CREATE — tarea del sprint (status `security-cleared`) |
| `docs/adr-sprint-17b-attendance-only-meeting-carnival.md` | CREATE — este ADR |

### Tests

| Archivo | Tests |
|---|---|
| `tests/unit/lib/events-policy.test.ts` (CREATE) | 12 — `isAttendanceOnlyEventType` (meeting/carnival ⇒ true; general/work_shift/otros/vacío/null/undefined ⇒ false, vía `it.each`) y `rejectAttendanceOnlyEvent` (rechazo con mensaje de turnos/ausencias, null para general/work_shift, «Evento no encontrado.» para inexistente; mocks del cliente supabase) |
| `tests/unit/lib/shifts-mutations.test.ts` (CREATE) | 11 — `createShift` (rechazo meeting/carnival; permitido general/work_shift; permisos intactos), `updateShift` (rechaza aunque el `eventId` del input sea general — fuente de verdad real; «Turno no encontrado.»; actualiza general), `deleteShift` (rechazo meeting; borrado general; «Turno no encontrado.») |
| `tests/unit/lib/absences-mutations.test.ts` (CREATE) | 10 — `requestAbsence` (rechazo meeting/carnival; permitido general), `justifyAbsence` (rechazo meeting/carnival con fuente de verdad real; «Ausencia no encontrada.»; justifica general), `deleteAbsence` (rechazo meeting; borrado general; «Ausencia no encontrada.») |
| `tests/unit/lib/workgroups-mutations.test.ts` (CREATE) | 4 — `markWorkgroupAttendance` (rechazo para turnos de meeting/carnival; permitido general; «Turno no encontrado.») |
| `src/lib/shifts/__tests__/assignments.test.ts` (MODIFY) | +4 (12 total) — `canAssignToShift` bloquea management en meeting/carnival, mantiene management en general/work_shift, y bloquea leads incluso en solo-asistencia que ellos crearon |

**Total de la suite: 585 tests en 42 archivos, todos pasando** (544 previos del Sprint 17 + 41 nuevos). `npx tsc --noEmit` y `npx eslint . --max-warnings=0` limpios (salida verificada: exit 0). Security scan sin issues HIGH.