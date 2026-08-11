# ADR-012: Sprint 12 — Asociación de Personas a Turnos y Visibilidad por Grupo

**Status:** Accepted · **Date:** 2026-08-10

---

## Context

La Umsuka Imbali App gestionaba los turnos de trabajo asumiendo que todo el grupo (p. ej. toda la "barra") cubría todos los turnos. Esto no reflejaba la realidad: cada turno debe estar cubierto por **miembros concretos**. Además, los eventos de tipo `work_shift` eran visibles para todos los miembros, y cualquier responsable de grupo podía crear eventos de trabajo, sin que existiera una asociación explícita entre el evento, el grupo y su responsable.

Se requería:

- **Asignación concreta por turno**: asignar/desasignar miembros específicos a cada turno, con `confirmed` y `created_by` en `shift_assignments`.
- **Eventos de trabajo por grupo**: solo los responsables (`is_workgroup_lead`) pueden crear/editar/eliminar sus propios eventos de tipo trabajo, marcados con el grupo (`created_by_workgroup`) y con visibilidad restringida (`visible_to_group`).
- **Feed filtrado**: cada miembro solo ve eventos generales + los de su grupo de trabajo; nadie ve eventos de trabajo de otros grupos.
- **Seguridad**: defensa en profundidad (Zod + autorización en servidor + RLS).

### Dependencias

- Sprint 2 (Workgroup Roles — `is_workgroup_lead`, `current_user_workgroup`).
- Sprint 8 (Shifts — gestión base de turnos, `shifts`, `shift_assignments`, conflictos).

---

## Decisión

Se implementó la visibilidad por grupo y la asignación concreta siguiendo el patrón arquitectónico de los módulos anteriores (schema Zod → queries/mutations → server actions), con las siguientes decisiones:

### 1. Migración de base de datos — `20260101004000_shift_assignment_groups.sql`

**`umsuka.shift_assignments`** — columnas añadidas:

| Columna | Tipo | Default | Descripción |
|---------|------|---------|-------------|
| `confirmed` | `boolean` | `false` | El miembro ha confirmado que cubrirá el turno |
| `created_by` | `uuid` FK → `auth.users(id)` | `null` (SET NULL on delete) | Usuario (management o lead) que creó la asignación |

El índice único `(shift_id, user_id)` y el índice por `user_id` ya existían desde la tabla base (Sprint 8), por lo que no se recrearon.

**`umsuka.events`** — columnas añadidas:

| Columna | Tipo | Default | Descripción |
|---------|------|---------|-------------|
| `visible_to_group` | `umsuka.workgroup` | `null` | Si está fijado, solo los miembros de ese grupo ven el evento. `null` = visible para todos |
| `created_by_workgroup` | `umsuka.workgroup` | `null` | Grupo del responsable que creó el evento (solo `work_shift`) |

Índices: `idx_events_visible_to_group`, `idx_events_created_by_workgroup`.

### 2. RLS — `umsuka.events`

| Operación | Política | Regla |
|-----------|----------|-------|
| `SELECT` | `events_select_authenticated` (reemplazada) | `visible_to_group IS NULL` **o** `visible_to_group = current_user_workgroup()` **o** `is_management()` |
| `INSERT` | `events_insert_lead_work_shift` (nueva) | `event_type = 'work_shift'` **y** `is_workgroup_lead(created_by_workgroup)` |
| `UPDATE` | `events_update_lead_work_shift` (nueva) | `event_type = 'work_shift'` **y** `created_by = auth.uid()` **y** `is_workgroup_lead(created_by_workgroup)` (USING y WITH CHECK) |
| `DELETE` | `events_delete_lead_work_shift` (nueva) | `event_type = 'work_shift'` **y** `created_by = auth.uid()` **y** `is_workgroup_lead(created_by_workgroup)` |

La política existente `events_write_management` (management para todas las operaciones) se mantiene: management sigue pudiendo gestionar cualquier evento, incluidas las operaciones sobre eventos de grupo. El `WITH CHECK` de UPDATE impide que un lead convierta su evento de trabajo en otro tipo o lo reasigne a otro grupo.

### 3. RLS — `umsuka.shift_assignments`

Se sustituyeron las políticas INSERT/DELETE para añadir la restricción de grupo al caso lead:

```sql
with check (
  umsuka.is_management()
  or exists (
    select 1 from umsuka.shifts s
    where s.id = shift_id
      and umsuka.is_workgroup_lead_for_event(s.event_id)
      and (s.workgroup is null or s.workgroup::text = umsuka.current_user_workgroup())
  )
)
```

Un responsable solo puede asignar/desasignar miembros en turnos de eventos `work_shift` **creados por él** y cuyo filtro de grupo (si existe) coincide con su grupo. Mismo criterio en DELETE.

### 4. Capa de negocio — `src/lib/shifts/assignments.ts`

Nuevo módulo dedicado a la asignación (se eliminan `assignMember`/`unassignMember` de `mutations.ts`, que eran solo-management):

| Función | Descripción |
|---------|-------------|
| `canAssignToShift(actor, shift, event)` | **Helper puro** que replica la regla RLS: management siempre; lead solo si evento `work_shift` creado por él y grupo del turno coincide (o sin filtro). Unit-testable sin BD. |
| `getShiftAssignments(shiftId)` | Asignaciones del turno con nombres de perfil (patrón 2 queries + Map, sin N+1). |
| `getMyAssignedShifts(userId)` | Turnos del usuario con datos del evento (sustituye a `getUserShifts`). |
| `assignMemberToShift(input)` | Valida schema, autorización (`assertCanAssign`), duplicados, `max_assignees`, filtro de grupo del miembro, conflictos horarios; inserta con `created_by`. |
| `unassignMemberFromShift(input)` | Valida schema y autorización; elimina la asignación. |

En `src/lib/shifts/queries.ts` se eliminó `getUserShifts` (trasladado a `getMyAssignedShifts`) y `src/app/profile/shifts/page.tsx` usa la nueva función.

### 5. Server actions — `src/app/events/[id]/shift-actions.ts`

`assignMemberToShiftAction` y `unassignMemberFromShiftAction` (nombres según plan del sprint), delegando en la nueva capa y haciendo `revalidatePath` del evento.

### 6. UI — Gestión de asignación por toggles

`ShiftAssignmentList` pasa de un dropdown de "todos los activos" a una **lista de miembros del grupo con checkbox/toggle**: si el turno tiene filtro de grupo, solo se muestran los miembros de ese grupo; si no, todos los miembros activos. Cada toggle asigna/desasigna. Respeta `max_assignees` (checkbox deshabilitado para no-asignados cuando el turno está completo) y muestra errores de servidor.

### 7. UI — Eventos por grupo

- **`EventForm`**: nuevo campo `workgroup` (solo se muestra para `eventType = work_shift`). Los leads no-management ven el tipo fijado a `work_shift` y el grupo bloqueado al suyo (prop `leadWorkgroup`).
- **`/events/new`**: permite acceder a leads (antes solo management); `defaultValues` preparados según rol.
- **`/events` y `/events/[id]`**: badge "Grupo: X" cuando `visible_to_group` no es nulo.
- **`/events/[id]`**: `canManage` corregido — un lead solo puede gestionar los `work_shift` que él creó (`event.createdBy === profile.id`), no cualquier evento de trabajo.

### 8. Schema de eventos — `src/lib/events/schema.ts`

Se reestructuró en campos base (`EVENT_FORM_FIELDS`) con `refine` a nivel de objeto (mismo patrón que `shifts/schema.ts` para evitar los problemas de `ZodEffects.extend`):

- `workgroup`: `z.enum(["telas", "barra", "estandarte", "limpieza"])`, nullable, default `null` (excluye `"ninguno"`).
- Refinamiento: `eventType = "work_shift"` requiere `workgroup` no nulo (aplica a `eventFormSchema`, `createEventSchema` y `updateEventSchema`).

### 9. Mutaciones de eventos — `src/lib/events/mutations.ts`

- **`createEvent`**: los `work_shift` requieren lead (o management). `resolveWorkShiftGroup()` fuerza que un lead solo use **su propio grupo** (si pidiera otro → error). Se insertan `visible_to_group` y `created_by_workgroup = grupo`. El turno auto-creado hereda el `workgroup` del evento.
- **`updateEvent`**: para `work_shift` existentes, un lead no puede cambiar el tipo ni el grupo (fijado al suyo); management sí puede editar (manteniendo el tipo `work_shift`, con su grupo elegido). Eventos generales: solo management (y `visible_to_group` vuelve a `null`).
- **`deleteEvent`**: para `work_shift`, el creador debe ser lead (además de management).

### 10. Tipos regenerados

`src/types/database.types.ts` actualizado manualmente siguiendo el formato generado por `supabase gen types` (sin entorno local disponible): nuevas columnas en `events` y `shift_assignments`.

---

## Decisiones arquitectónicas clave

| # | Decisión | Alternativa considerada | Razón |
|---|----------|------------------------|-------|
| 1 | **Visibilidad por columna `visible_to_group` en `events`** | Tabla separada de visibilidad | Sencilla y suficiente para un grupo por evento; la tabla separada se pospone a Sprint 18 (audiencia múltiple). |
| 2 | **Helper puro `canAssignToShift` replicando RLS** | Solo RLS | Defensa en profundidad + mensajes de error específicos + testabilidad sin BD. |
| 3 | **Lead solo gestiona eventos que creó** | Lead puede gestionar cualquier `work_shift` de su grupo | Consistencia con `is_workgroup_lead_for_event` (creado por) ya usada en Sprint 8 y con el RLS de eventos. Evita ambigüedad de propiedad. |
| 4 | **Management siempre ve todo (SELECT)** | Management filtrado por grupo | Management necesita gestionar/borrar eventos de grupo; coherente con su rol operativo. |
| 5 | **Toggle list en vez de dropdown** | Dropdown de miembros (Sprint 8) | Muestra de un vistazo quién está/quién no asignado en el grupo; menos clics; UX acorde al objetivo del sprint. |
| 6 | **`workgroup` requerido en el schema para `work_shift`** | Validación solo en servidor | Falla temprano en el cliente con mensaje claro; el formulario nunca envía un `work_shift` sin grupo. |
| 7 | **Un lead no puede convertir su `work_shift` en otro tipo** | Permitir conversión por el creador | El RLS (`WITH CHECK`) lo bloquea; mantener la misma regla en la capa de aplicación evita errores opacos de RLS. |

---

## Edge cases manejados

### Validación de schemas (21 tests nuevos de eventos)

| Escenario | Comportamiento |
|-----------|----------------|
| `work_shift` sin `workgroup` | Rechazado: "For work shift events you must choose the target workgroup." |
| `work_shift` con `"ninguno"` | Rechazado (enum excluye `ninguno`) |
| Evento general sin `workgroup` | Aceptado; `workgroup` normalizado a `null` |
| `capacity` NaN | Normalizado a `null` |
| `capacity` ≤ 0 | Rechazado |
| Fecha inválida | Rechazado |

### Visibilidad (6 tests)

| Escenario | Comportamiento |
|-----------|----------------|
| Evento general (`visible_to_group = null`) | Visible para todos, incluidos miembros sin grupo |
| Miembro del grupo objetivo | Visible |
| Miembro de otro grupo | No visible |
| Miembro sin grupo (`ninguno`) | Solo eventos generales |
| Management | Siempre visible (flag `isManagement`) |

### Asignación (8 tests)

| Escenario | Comportamiento |
|-----------|----------------|
| Management asigna a cualquier turno | Permitido |
| Lead asigna en su propio evento `work_shift` de su grupo | Permitido |
| Lead asigna en evento de otro grupo | Bloqueado |
| Lead asigna en evento que no creó | Bloqueado |
| Lead asigna en evento no `work_shift` | Bloqueado |
| Miembro no-lead asigna | Bloqueado |
| Turno sin filtro de grupo en evento propio del lead | Permitido |

### Seguridad y autorización

| Escenario | Comportamiento |
|-----------|----------------|
| Lead intenta crear `work_shift` para otro grupo | Error en servidor: "Solo puedes crear eventos de tipo trabajo para tu propio grupo." |
| Miembro regular intenta crear `work_shift` | Error: "Solo los responsables de grupo pueden crear eventos de tipo trabajo." |
| Lead intenta editar/borrar evento de trabajo ajeno | Error: "No tienes permiso para editar/eliminar este evento." |
| Lead intenta cambiar el tipo de su `work_shift` | Error: "No puedes cambiar el tipo de un evento de tipo trabajo." |
| Miembro navega directamente a URL de evento de otro grupo | `getEventById` retorna `null` → 404 (RLS) |
| Turno lleno (`max_assignees`) | Toggle deshabilitado para no asignados |

---

## Consecuencias

### Positivas

- Asignación concreta por turno (miembros específicos, no todo el grupo).
- Eventos de trabajo con dueño de grupo explícito y visibilidad restringida por RLS.
- Feed de eventos (lista, calendario, dashboard) filtrado automáticamente por grupo.
- Defensa en profundidad: schema Zod + autorización en servidor + RLS.
- Regla de visibilidad y de asignación replicadas en helpers puros con tests unitarios.
- 35 tests nuevos, 0 regresiones (329 tests en total).
- Build, lint (en los archivos del sprint) y typecheck sin errores nuevos.

### Negativas / Riesgos

- **`visible_to_group` de un único grupo por evento**: no permite audiencias múltiples; se resuelve en Sprint 18 (Event Audience) que extiende el mismo patrón.
- **`confirmed` aún sin flujo de confirmación**: la columna existe pero el miembro aún no puede confirmar su turno desde la UI (pendiente de sprint futuro).
- **`created_by` en asignaciones sin auditoría visual**: se registra el creador de la asignación pero la UI no lo muestra.
- **Los eventos `work_shift` creados antes de esta migración quedan visibles para todos** (su `visible_to_group` es `null`), comportamiento compatible con el anterior.

### Técnicas

- `ADD COLUMN IF NOT EXISTS` para idempotencia; políticas con `DROP POLICY IF EXISTS` + `CREATE POLICY`.
- El `WITH CHECK` de la política UPDATE de eventos impide a un lead "reescribir" su evento fuera de su grupo o cambiar su tipo.
- Patrón 2 queries + Map para enriquecer asignaciones con perfiles (sin N+1).
- `useWatch` de React Hook Form para mostrar el selector de grupo solo cuando el tipo es `work_shift`.

---

## Archivos Modificados/Creados

| Archivo | Acción |
|---------|--------|
| `supabase/migrations/20260101004000_shift_assignment_groups.sql` | CREATE |
| `src/lib/shifts/assignments.ts` | CREATE |
| `src/lib/shifts/__tests__/assignments.test.ts` | CREATE |
| `src/lib/events/__tests__/schema.test.ts` | CREATE |
| `src/lib/events/__tests__/visibility.test.ts` | CREATE |
| `src/lib/events/schema.ts` | MODIFY — `workgroup` + refinements |
| `src/lib/events/queries.ts` | MODIFY — `visibleToGroup`/`createdByWorkgroup` + `isEventVisibleToGroup` |
| `src/lib/events/mutations.ts` | MODIFY — lógica de grupo para lead/management |
| `src/lib/shifts/mutations.ts` | MODIFY — eliminados `assignMember`/`unassignMember` |
| `src/lib/shifts/queries.ts` | MODIFY — eliminado `getUserShifts` |
| `src/app/events/[id]/shift-actions.ts` | MODIFY — acciones renombradas |
| `src/app/events/[id]/shift-assignment-list.tsx` | MODIFY — toggles de miembros |
| `src/app/events/[id]/page.tsx` | MODIFY — `canManage` lead + badge de grupo |
| `src/app/events/event-form.tsx` | MODIFY — selector de grupo para `work_shift` |
| `src/app/events/new/page.tsx` | MODIFY — acceso leads + defaults |
| `src/app/events/page.tsx` | MODIFY — badge de grupo |
| `src/app/profile/shifts/page.tsx` | MODIFY — `getMyAssignedShifts` |
| `src/types/database.types.ts` | MODIFY — columnas nuevas |
| `tasks/sprint-12-shift-assignment-groups.json` | CREATE |
| `tasks/plan-desarrollo-completo.md` | MODIFY — Sprint 12 marcado ✅ Ejecutado |
| `docs/DATABASE.md` | MODIFY — migraciones y RLS |
