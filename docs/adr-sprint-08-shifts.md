# ADR-008: Sprint 8 — Turnos: Creación, Asignación y Control de Conflictos (Shifts)

**Status:** Accepted · **Date:** 2026-07-30

---

## Context

Los eventos de la Umsuka Imbali App (carnavales, reuniones, turnos de trabajo) necesitan turnos (shifts) con horarios definidos a los que se puedan asignar miembros. Hasta el Sprint 7, las tablas `umsuka.shifts` y `umsuka.shift_assignments` existían como estructura mínima pero sin funcionalidad operativa.

Se requería un sistema completo de gestión de turnos que permitiera:

- Crear turnos con hora de inicio, fin, capacidad máxima, filtro por grupo de trabajo y notas internas.
- Asignar y desasignar miembros a turnos.
- Detectar y prevenir conflictos horarios (solapamiento de turnos para un mismo miembro).
- Mostrar a los miembros sus turnos asignados en su perfil.
- Visualizar los turnos en una línea de tiempo gráfica (timeline).
- Permitir que los management roles y los workgroup leads (para sus propios eventos `work_shift`) puedan gestionar turnos.

## Decisión

Se implementó un módulo completo de gestión de turnos con las siguientes decisiones arquitectónicas:

### 1. Mejora del esquema de base de datos

Se añadieron tres columnas a `umsuka.shifts`:

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `max_assignees` | `int (nullable)` | Límite opcional de miembros asignables. `null` = sin límite. |
| `workgroup` | `umsuka.workgroup (nullable)` | Filtro opcional de grupo de trabajo. Solo miembros de ese grupo pueden ser asignados. |
| `notes` | `text (nullable)` | Notas internas visibles solo para management. |

Se añadió la constraint `CHECK (max_assignees IS NULL OR max_assignees > 0)` para garantizar valores positivos.

### 2. Nueva función auxiliar SQL `is_workgroup_lead_for_event(uuid)`

Función SECURITY DEFINER que retorna `true` si el usuario actual es un workgroup lead **y** el evento especificado es de tipo `work_shift` creado por dicho usuario. Se usa en las políticas RLS para permitir que los workgroup leads gestionen turnos de sus propios eventos sin necesidad de tener un rol de management.

```sql
create or replace function umsuka.is_workgroup_lead_for_event(event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select exists (
    select 1
    from umsuka.profiles p
    join umsuka.events e on e.id = event_id
    where p.id = auth.uid()
      and p.is_workgroup_lead = true
      and e.event_type = 'work_shift'
      and e.created_by = auth.uid()
  );
$$;
```

### 3. Capa de aplicación `src/lib/shifts/`

Organizada en tres archivos siguiendo la arquitectura del proyecto:

- **`schema.ts`**: Schemas Zod para formulario y operaciones CRUD. Todos los schemas usan campos base compartidos (`SHIFT_FORM_FIELDS`) spreadeados en lugar de `.extend()` para evitar problemas con `ZodEffects.refine()`.
- **`queries.ts`**: `getEventShifts`, `getShiftById`, `getUserShifts`, `checkShiftConflicts`, `getAvailableMembers`, `shiftsOverlap` (función pura).
- **`mutations.ts`**: `createShift`, `updateShift`, `deleteShift`, `assignMember`, `unassignMember`.

### 4. Algoritmo de detección de solapamiento (two-interval overlap)

Se utiliza el algoritmo clásico de dos intervalos: dos turnos `[A.start, A.end)` y `[B.start, B.end)` se solapan si:

```
A.start < B.end AND A.end > B.start
```

Este algoritmo:
- Detecta solapamientos parciales, contención (A contiene B o B contiene A), e intervalos exactamente iguales.
- NO detecta falsos positivos en turnos adyacentes (`A.end === B.start`).
- Se implementa tanto como función pura (`shiftsOverlap` en queries.ts) como consulta SQL (`.lt("shifts.start_time", endTime).gt("shifts.end_time", startTime)` en `checkShiftConflicts`).

### 5. Defensa en profundidad para conflictos

La detección de conflictos se aplica en dos lugares:

| Capa | Mecanismo |
|------|-----------|
| **Servidor (mutations.ts)** | `assignMember()` llama a `checkShiftConflicts()` antes de insertar la asignación. Si hay conflictos, retorna error descriptivo. |
| **Base de datos** | No hay constraint UNIQUE compuesta que prevenga solapamientos (no es posible en SQL estándar), pero el servidor es el único punto de entrada. |

### 6. Autorización de dos niveles

`assertCanManageShifts(eventId)` implementa una cadena de autorización:

1. Si el usuario tiene un rol de management (`super_admin`, `admin`, `board_member`, `event_manager`) → permiso concedido.
2. Si el usuario es workgroup lead **y** el evento es `work_shift` **y** fue creado por él → permiso concedido.
3. En cualquier otro caso → error.

### 7. Spread de field definitions en Zod (evitando `.extend()`)

Los schemas `createShiftSchema` y `updateShiftSchema` comparten fields con `shiftFormSchema` mediante spread del objeto `SHIFT_FORM_FIELDS` en lugar de usar `.extend()`. Esto se decidió porque:

- `.extend()` en schemas que tienen `.refine()` (ZodEffects) causa problemas de tipado y herencia de refinements.
- Spread de un objeto plano es idiomático, predecible y no arrastra refinements parentales.

### 8. Optimización de consultas N+1

`getEventShifts()` evita el problema N+1 realizando:

1. Una consulta para obtener todos los shifts del evento.
2. Una consulta `IN (shiftIds...)` para obtener todas las asignaciones.
3. Una consulta `IN (userIds...)` para obtener los perfiles.
4. Ensamblado en memoria mediante `Map` para O(n) total.

### 9. Componentes UI

| Componente | Props clave | Responsabilidad |
|------------|-------------|-----------------|
| `ShiftForm` | `mode`, `eventId`, `onSubmit` | Formulario crear/editar con validación Zod en cliente |
| `ShiftTimeline` | `shifts: ShiftWithAssignments[]` | Línea temporal visual con escala de horas y barras horizontales |
| `ShiftAssignmentList` | `shiftId`, `assignments`, `availableMembers`, `canManage` | Asignar/desasignar miembros con filtro de grupo |
| `ShiftManagementPanel` | `eventId`, `shifts`, `availableMembers`, `canManage` | Panel compuesto que integra timeline + lista + formularios |

### 10. Server actions delgadas

`shift-actions.ts` contiene wrappers `"use server"` que delegan en `mutations.ts` y llaman a `revalidatePath()` tras éxito. No contienen lógica de negocio — solo orquestación de cache de Next.js.

### 11. Página de perfil `/profile/shifts`

Página server component que muestra los turnos asignados al miembro actual en formato de tabla con: nombre del turno, evento (link), fecha del evento, inicio y fin. Usa `getUserShifts(profile.id)`.

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Página de evento (/events/[id]/page.tsx)                               │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  ShiftManagementPanel                                              │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │  │
│  │  │ ShiftForm     │  │ ShiftTimeline│  │ ShiftAssignmentList    │ │  │
│  │  │ (crear/editar)│  │ (visual)     │  │ (asignar/desasignar)   │ │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────────┘ │  │
│  └─────────┼─────────────────┼─────────────────────┼────────────────┘  │
└────────────┼─────────────────┼─────────────────────┼───────────────────┘
             │                 │                     │
    ┌────────▼─────────────────▼─────────────────────▼───────────────────┐
    │  Server Actions (shift-actions.ts)                                  │
    │  createShiftAction / updateShiftAction / deleteShiftAction          │
    │  assignMemberAction / unassignMemberAction                          │
    │  (revalidatePath on success)                                       │
    └────────┬───────────────────────────────────────────────────────────┘
             │
    ┌────────▼───────────────────────────────────────────────────────────┐
    │  Application Layer (src/lib/shifts/)                                │
    │  ┌────────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
    │  │ schema.ts      │  │ queries.ts   │  │ mutations.ts           │ │
    │  │ (Zod schemas)  │  │ (lectura BD) │  │ (escritura BD + auth)  │ │
    │  └────────────────┘  └──────┬───────┘  └──────────┬─────────────┘ │
    └──────────────────────────────┼────────────────────┼────────────────┘
                                   │                    │
    ┌──────────────────────────────▼────────────────────▼────────────────┐
    │  Supabase (RLS enforced)                                           │
    │  ┌──────────────────────┐  ┌────────────────────────────────────┐  │
    │  │ umsuka.shifts        │  │ umsuka.shift_assignments           │  │
    │  │ Políticas:           │  │ Políticas:                         │  │
    │  │ SELECT: authenticated│  │ SELECT: own / management / lead   │  │
    │  │ INSERT/UPDATE/DELETE:│  │ INSERT: management / lead         │  │
    │  │   management / lead  │  │ DELETE: management / lead         │  │
    │  └──────────────────────┘  └────────────────────────────────────┘  │
    │  Helper: is_workgroup_lead_for_event(uuid)                         │
    └────────────────────────────────────────────────────────────────────┘
                                                                          
┌─────────────────────────────────────────────────────────────────────────┐
│  Perfil (/profile/shifts/page.tsx)                                      │
│  getUserShifts(profile.id) → tabla con turnos asignados                │
└─────────────────────────────────────────────────────────────────────────┘
```

### Flujo de asignación con detección de conflictos

```
┌────────────┐     ┌──────────────┐     ┌──────────────┐     ┌───────────────┐
│ Assignment  │     │ assignMember │     │ checkShift-  │     │ Supabase      │
│ List (UI)   │     │ (mutations)  │     │ Conflicts    │     │ (RLS + data)  │
├────────────┤     ├──────────────┤     ├──────────────┤     ├───────────────┤
│ 1. User    │────>│ 2. Validate  │     │              │     │               │
│    clicks  │     │    Zod       │     │              │     │               │
│    "Asignar"│     │ 3. Auth check│     │              │     │               │
│            │     │ 4. Get shift │────>│              │     │               │
│            │     │    details   │     │              │     │               │
│            │     │ 5. Check     │────>│ 6. Query     │────>│ 7. SELECT     │
│            │     │    duplicate  │     │    overlaps  │     │    overlaps   │
│            │     │ 6. Check     │     │ 8. Return    │<────│ 9. Results    │
│            │     │    max_assign │     │    conflicts │     │               │
│            │     │ 7. Check     │     │              │     │               │
│            │     │    workgroup  │     │              │     │               │
│            │     │ 8. Check     │<────│              │     │               │
│            │     │    conflicts  │     │              │     │               │
│            │     │ 9. IF no     │────>│              │────>│ 10. INSERT    │
│            │     │    conflicts  │     │              │     │    assignment │
│            │<────│ 10. Return   │     │              │     │               │
│            │     │    result    │     │              │     │               │
└────────────┘     └──────────────┘     └──────────────┘     └───────────────┘
```

## Resumen de políticas RLS

### Tabla `umsuka.shifts`

| Operación | Política | Destinatarios |
|-----------|----------|---------------|
| `SELECT` | `shifts_select_authenticated` | Todos los usuarios autenticados (`using: true`) |
| `INSERT` | `shifts_insert_management_or_lead` | Management roles **o** workgroup leads de su `work_shift` |
| `UPDATE` | `shifts_update_management_or_lead` | Management roles **o** workgroup leads de su `work_shift` |
| `DELETE` | `shifts_delete_management_or_lead` | Management roles **o** workgroup leads de su `work_shift` |

### Tabla `umsuka.shift_assignments`

| Operación | Política | Destinatarios |
|-----------|----------|---------------|
| `SELECT` | `shift_assignments_select_own_or_management` | El propio miembro (`user_id = auth.uid()`) **o** management |
| `SELECT` | `shift_assignments_select_lead` | Workgroup leads (para asignaciones de sus eventos `work_shift`) |
| `INSERT` | `shift_assignments_insert_management_or_lead` | Management **o** workgroup leads |
| `DELETE` | `shift_assignments_delete_management_or_lead` | Management **o** workgroup leads |
| `UPDATE` | *(no definida)* | No hay mutación que actualice asignaciones actualmente |

No existe política `UPDATE` para `shift_assignments` porque ninguna operación actualiza una asignación existente. Si en el futuro se añade cambio de estado, se deberá agregar la política correspondiente.

## Edge cases manejados

### Validación de schemas (24 tests)

| Escenario | Comportamiento |
|-----------|----------------|
| Nombre vacío | Rechazado |
| Nombre > 200 caracteres | Rechazado |
| `endTime` anterior a `startTime` | Rechazado con error en path `endTime` |
| `maxAssignees` = NaN | Normalizado a `null` |
| `maxAssignees` = 3.5 (no entero) | Rechazado |
| `maxAssignees` = 0 o negativo | Rechazado |
| `maxAssignees` = entero positivo | Aceptado |
| `notes` = string vacío | Normalizado a `null` |
| `workgroup` = `"ninguno"` | Aceptado (sin filtro) |
| `workgroup` = valor inválido | Rechazado |
| `eventId` / `id` UUID inválido | Rechazado |
| `shiftId` / `userId` / `assignmentId` ausente | Rechazado |

### Detección de solapamiento (8 tests unitarios para `shiftsOverlap`)

| Escenario | A.start | A.end | B.start | B.end | ¿Solapa? |
|-----------|---------|-------|---------|-------|----------|
| Solapamiento parcial | 10:00 | 12:00 | 11:00 | 13:00 | **Sí** |
| Adyacentes (sin solape) | 10:00 | 12:00 | 12:00 | 14:00 | No |
| A termina antes de B empiece | 10:00 | 12:00 | 12:01 | 14:00 | No |
| A contiene B | 10:00 | 14:00 | 11:00 | 12:00 | **Sí** |
| B contiene A | 11:00 | 12:00 | 10:00 | 14:00 | **Sí** |
| Exactamente igual | 10:00 | 12:00 | 10:00 | 12:00 | **Sí** |
| Rangos completamente separados | 10:00 (Día 1) | 12:00 (Día 1) | 10:00 (Día 2) | 12:00 (Día 2) | No |
| Solape por milisegundo | 10:00 | 12:00 | 11:59:59 | 13:00 | **Sí** |

### Validaciones en `assignMember()` (servidor)

1. **Duplicado**: Se consulta si ya existe una asignación para el mismo `shift_id` + `user_id` antes de insertar. Además, se captura la excepción `23505` (unique violation) por si llegara a ocurrir.
2. **Capacidad máxima**: Si `max_assignees` no es `null`, se cuenta el número actual de asignaciones. Si `count >= max_assignees`, se rechaza la asignación.
3. **Filtro de grupo de trabajo**: Si el turno tiene un `workgroup` definido (distinto de `"ninguno"`), se verifica que el perfil del miembro tenga ese mismo `workgroup`.
4. **Conflictos horarios**: Se llama a `checkShiftConflicts()` pasando `excludeShiftId` (el turno actual) para evitar falsos positivos al reasignar.
5. **Manejo de errores de BD**: Captura de error `23505` como fallback de seguridad contra condiciones de carrera.

## Consecuencias

### Positivas
- Sistema completo de turnos con creación, edición, eliminación y asignación.
- Detección robusta de conflictos horarios (probada con 8 casos edge).
- Defensa en profundidad: validación Zod + autorización en servidor + RLS.
- Workgroup leads pueden gestionar turnos de sus propios eventos sin necesidad de rol management.
- Interfaz visual (timeline) para detectar solapamientos gráficamente.
- Los miembros pueden consultar sus turnos asignados en `/profile/shifts`.
- Consultas optimizadas (sin N+1 gracias a Map y consultas IN).
- 32 nuevos tests (24 schema + 8 conflictos) con 0 regresiones (217 tests totales).

### Negativas / Riesgos
- No existe constraint CHECK a nivel BD para prevenir solapamientos (no es posible en PostgreSQL sin exclusion constraints con GiST y tipos range, lo cual añadiría complejidad innecesaria para este caso de uso).
- La autorización para workgroup leads depende de la combinación `event_type = 'work_shift'` y `created_by = auth.uid()` — si un evento cambia de tipo o de creador, los permisos existentes pueden quedar desactualizados (aunque esto es poco frecuente).
- `getEventShifts()` realiza 3 consultas independientes (shifts + assignments + profiles) — aunque es mejor que N+1, una sola consulta SQL con JOINs podría ser más eficiente para eventos con muchos turnos.

### Técnicas
- Se agregaron índices en `shifts(workgroup)` y `shifts(start_time, end_time)` para optimizar consultas de filtrado y solapamiento.
- La migración usa `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` para ser idempotente.
- Se otorgó `GRANT EXECUTE ON FUNCTION umsuka.is_workgroup_lead_for_event(uuid) TO authenticated` para que RLS pueda invocarla.
- Se actualizó `src/types/database.types.ts` con los nuevos campos.
- Se integró `ShiftManagementPanel` en la página de detalle de evento (visible para todos los tipos de evento, no solo `work_shift`).

## Post-implementation fixes

Tras la aceptación del ADR se aplicaron tres categorías de cambios correctivos:

### 1. Bug fix: `service_role` SELECT grants

**Contexto:** La migración `20260101003000_service_role_grants.sql` otorgaba permisos `INSERT`, `UPDATE` y `DELETE` sobre `umsuka.profiles` y `umsuka.email_aliases` al rol `service_role`, pero omitía el permiso `SELECT`. Esto provocaba el error `"permission denied for table profiles"` al iniciar sesión con usuario/contraseña, ya que la función `resolveUsernameToEmail()` utiliza un cliente admin (`service_role`) para consultar dichas tablas.

**Decisión:** Se creó la migración `supabase/migrations/20260101003300_service_role_select_grants.sql` que añade `GRANT SELECT` al rol `service_role` sobre las siguientes tablas:

| Tabla | Propósito |
|-------|-----------|
| `umsuka.profiles` | `resolveUsernameToEmail()` busca el perfil por username |
| `umsuka.email_aliases` | Resolver `profile_id` a su alias de email interno |
| `umsuka.events` | Futuras operaciones administrativas |
| `umsuka.shifts` | Futuras operaciones administrativas |
| `umsuka.shift_assignments` | Futuras operaciones administrativas |

**Archivos afectados:**
| Archivo | Acción |
|---------|--------|
| `supabase/migrations/20260101003300_service_role_select_grants.sql` | CREATE |

### 2. Bug fix: middleware schema config

**Contexto:** El archivo `src/lib/supabase/middleware.ts` creaba el cliente de Supabase con `createServerClient()` sin especificar `db: { schema: "umsuka" }`. Como resultado, las funciones RPC (ej. `current_user_status()`) y las consultas a tablas del schema `umsuka` fallaban porque el cliente por defecto opera sobre el schema `public`.

**Decisión:** Se añadió la opción `db: { schema: "umsuka" }` a la configuración de `createServerClient` en `middleware.ts`, alineando el middleware con el resto de clientes del proyecto (`serverClient`, `adminClient`) que ya especificaban el schema explícitamente.

```typescript
const supabase = createServerClient<Database>(
  clientEnv.NEXT_PUBLIC_SUPABASE_URL,
  clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    db: { schema: "umsuka" },  // ← añadido
    cookieOptions: SERVER_AUTH_COOKIE_OPTIONS,
    // ...
  },
);
```

**Archivos afectados:**
| Archivo | Acción |
|---------|--------|
| `src/lib/supabase/middleware.ts` | MODIFY |

### 3. Code cleanup: ESLint `@typescript-eslint/no-unused-vars`

**Contexto:** Tras la implementación inicial, varios linting reports señalaron imports, props y variables declaradas pero nunca utilizadas. Se eliminaron para mantener la base de código limpia y evitar warnings en CI.

**Archivos y cambios:**

| Archivo | Elemento eliminado | Motivo |
|---------|-------------------|--------|
| `src/app/events/[id]/shift-form.tsx` | `import { Workgroup }` | Tipo no usado en el componente |
| `src/app/events/[id]/shift-management-panel.tsx` | Prop `eventType`, variable `editingShift`, import `EventTypeValue` | `eventType` nunca se consumía; `editingShift` era una variable huérfana (se usaba `editingShiftId` en su lugar); `EventTypeValue` ya no era necesario |
| `src/app/profile/shifts/page.tsx` | `import { Badge }` | Componente no usado en la tabla de turnos |
| `src/lib/shifts/mutations.ts` | `import { isManagementRole }` | La autorización delega en `assertCanManageShifts()` que maneja la lógica internamente |
| `src/lib/shifts/queries.ts` | Variable `shiftsById` | Declarada pero nunca referenciada |
| `src/lib/shifts/queries.ts` | Columna `created_at` en `getUserShifts` select | Type error: se añadió `created_at` al select de `getUserShifts()` para satisfacer el tipo de retorno |
| `src/lib/shifts/schema.ts` | `import { Workgroup }` | Tipo no usado en los schemas Zod |

**Archivos afectados:**
| Archivo | Acción |
|---------|--------|
| `src/app/events/[id]/shift-form.tsx` | MODIFY |
| `src/app/events/[id]/shift-management-panel.tsx` | MODIFY |
| `src/app/profile/shifts/page.tsx` | MODIFY |
| `src/lib/shifts/mutations.ts` | MODIFY |
| `src/lib/shifts/queries.ts` | MODIFY |
| `src/lib/shifts/schema.ts` | MODIFY |

## Archivos Modificados/Creados

| Archivo | Acción |
|---------|--------|
| `supabase/migrations/20260101003200_shifts_enhancement.sql` | CREATE |
| `src/lib/shifts/schema.ts` | CREATE |
| `src/lib/shifts/queries.ts` | CREATE |
| `src/lib/shifts/mutations.ts` | CREATE |
| `src/app/events/[id]/shift-actions.ts` | CREATE |
| `src/app/events/[id]/shift-form.tsx` | CREATE |
| `src/app/events/[id]/shift-timeline.tsx` | CREATE |
| `src/app/events/[id]/shift-assignment-list.tsx` | CREATE |
| `src/app/events/[id]/shift-management-panel.tsx` | CREATE |
| `src/app/profile/shifts/page.tsx` | CREATE |
| `tests/unit/lib/shifts-schema.test.ts` | CREATE |
| `tests/unit/lib/shifts-conflicts.test.ts` | CREATE |
| `tasks/sprint-08-shifts.json` | CREATE |
| `src/types/database.types.ts` | MODIFY |
| `src/app/events/[id]/page.tsx` | MODIFY |
