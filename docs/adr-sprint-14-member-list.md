# ADR-014: Sprint 14 — Listado de Miembros para Directiva y Responsables de Grupo

**Status:** Accepted · **Date:** 2026-08-11

---

## Context
La directiva (roles `super_admin`/`admin`/`board_member`/`event_manager`) necesitaba un directorio de todos los miembros dados de alta en la comparsa (nombre, componente, grupo de trabajo, rol, estado y fecha de alta), mientras que cada responsable de grupo (`is_workgroup_lead`) solo debe ver **los miembros de su propio grupo de trabajo**. Un responsable no puede ver miembros de otros grupos.

Requisitos:

- Página `/members` con tabla filtrable (grupo, componente, estado, búsqueda por nombre).
- Ficha de detalle `/members/[id]` con perfil, turnos asignados y asistencia (reutilizando datos de sprints anteriores).
- Enlace de navegación visible solo para directiva y responsables de grupo.
- Seguridad: defensa en profundidad (helpers puros + validación en server actions + RLS).

### Restricciones heredadas

- La política RLS `profiles_select_authenticated` permite a cualquier miembro activo leer todos los perfiles (necesaria para el enriquecimiento de noticias/preguntas/eventos). **No se modifica**: el filtrado por grupo para los leads se aplica en la capa de aplicación.
- Las políticas SELECT de `shift_assignments` y `attendance` solo permiten al propietario o a management leer filas ajenas, por lo que un lead no podía cargar turnos/asistencia de los miembros de su grupo en la ficha.

---

## Decisión

### 1. Capa `src/lib/members/` — autorización pura y queries

- **`authorization.ts`** — helpers puros sin DB, la unidad de testeo central:
  - `canViewMembers(actor)` — management **o** (lead con `workgroup !== "ninguno"`).
  - `resolveMemberScope(actor)` — `{ kind: "all" }` para management, `{ kind: "workgroup", workgroup }` para lead (derivado **siempre** del actor, nunca del input); lanza `AuthorizationError` para el resto.
  - `canViewMemberDetail(actor, targetWorkgroup)` — management siempre; lead solo si `targetWorkgroup === actor.workgroup`.
  - `isLeadOfGroup(actor, workgroup)` — defensa en profundidad para `getWorkgroupMembers`.
  - Un lead con `workgroup = "ninguno"` se trata como no-lead en todos los helpers.
- **`schema.ts`** — `memberFiltersSchema` (workgroup/componentType/status opcionales + `q` trimmeada) y los tipos `MemberListItem`/`MemberDetail` (camelCase).
- **`queries.ts`** — cliente anónimo (nunca elevado):
  - `getAllMembers()` — sin filtros (management).
  - `getWorkgroupMembers(actor, workgroup)` — lanza `AuthorizationError` salvo que el actor sea lead de ese grupo exacto; luego `.eq("workgroup", workgroup)`.
  - `getMemberDetail(userId)` / `getMemberDetailWithHistory(userId)` — perfil (con `birth_date`) + `getMyAssignedShifts` + `getUserAttendance` (patrón de dos queries + join en memoria de sprints anteriores).

### 2. Server actions (`src/app/members/actions.ts`)

`getMembersAction()` resuelve el scope desde el perfil autenticado (`requireAuthenticatedProfile`) y devuelve todos o los del grupo. `getMemberDetailAction(userId)` valida con `canViewMemberDetail` **antes** de devolver datos; miembro inexistente → `{ success: true, data: null }` (la página hace `notFound()`), acceso no permitido → error (la página hace `notFound()` para no filtrar información).

### 3. RLS — migración `20260101004200_member_detail_lead_reads.sql`

Políticas **aditivas** de SELECT (PostgreSQL OR-ea múltiples políticas):

```sql
create policy "shift_assignments_select_lead_workgroup"
  on umsuka.shift_assignments for select
  to authenticated
  using (
    umsuka.is_active_member()
    and exists (
      select 1 from umsuka.profiles p
      where p.id = shift_assignments.user_id
        and umsuka.is_workgroup_lead(p.workgroup::text)
    )
  );
```

Y su análoga `attendance_select_lead_workgroup` sobre `umsuka.attendance`. No se elimina ni modifica ninguna política existente; la política de SELECT de `umsuka.profiles` queda intacta. Se usa `p.workgroup::text` siguiendo el patrón de la migración 0040 (`20260101004000_shift_assignment_groups.sql`: `is_workgroup_lead(created_by_workgroup::text)`), ya que `is_workgroup_lead` recibe `text`.

**Decisión deliberada: la política SELECT de `umsuka.profiles` NO se modifica.** Ajustar `profiles_select_authenticated` (p. ej. a `is_management() or id = auth.uid() or is_workgroup_lead(workgroup::text)`) filtraría los perfiles por grupo, pero **regresionaría el enriquecimiento de noticias, preguntas y eventos**, que leen los perfiles de cualquier miembro para mostrar autores/creadores (10+ puntos de llamada repartidos por esos módulos). Por eso el scoping de `/members` se aplica **en la capa de aplicación** con doble barrera: `resolveMemberScope` se deriva **siempre del actor de sesión, nunca del input del cliente**; `getWorkgroupMembers` revalida `isLeadOfGroup` antes de ejecutar; las páginas aplican guardas de rol y `notFound()` para el detalle entre grupos.

**Trade-off aceptado:** cualquier miembro activo puede leer filas de `umsuka.profiles` a través de la API pública (PostgREST) gracias a `profiles_select_authenticated`. La tabla **no contiene email ni credenciales** (esos datos viven en `auth.users`, inaccesible para el cliente), por lo que la exposición se limita a datos de identidad básicos: nombre, componente, grupo, rol, estado, `is_active`, `username` y fecha de alta. Es una decisión deliberada y documentada.

**Condiciones de activación para ajustar la política en el futuro** (cuando se cumpla cualquiera, sustituir `profiles_select_authenticated` por una política que distinga management / lead del grupo / propietario y adaptar los puntos de enriquecimiento):

1. Si `umsuka.profiles` pasa a almacenar campos sensibles (email, teléfono, dirección, biografía extensa, avatar privado).
2. Si los módulos de enriquecimiento (news/questions/events) se consolidan detrás de vistas o funciones propias que hagan seguro restringir el SELECT a nivel de tabla.
3. Si un requisito legal o de privacidad exige limitar la exposición de perfiles a la API pública.

### 4. UI

- **`/members`** — componente servidor: guardas de login y de `canViewMembers`; filtros en memoria (grupo/componente/estado exacto, `q` case-insensitive con normalización de acentos NFD en ambos lados); tabla con badges y fecha de alta en `es-ES`. Para leads: banner «Mostrando solo los miembros de tu grupo: X» y filtro de grupo oculto (`lockedWorkgroup`).
- **`member-filters.tsx`** — cliente, patrón de `category-filter.tsx` (searchParams vía `router.push`).
- **`/members/[id]`** — ficha de solo lectura: tarjeta de perfil (fecha de nacimiento **solo** para management), tabla de turnos asignados y tabla de asistencia con resumen presentes/ausentes. Un lead que intente ver a un miembro de otro grupo recibe `notFound()`.
- **Navegación** — `NavLinkContext` `{ role, isWorkgroupLead, workgroup }`; nuevo enlace «Directorio» (`/members`) visible para management o leads. `AppShell` propaga `isWorkgroupLead`/`workgroup` a `Sidebar` y `BottomNav`.

### 5. Cambios colindantes

- `getAllWorkgroupMembers(workgroup?)` en `lib/workgroups/queries.ts` acepta filtro opcional; el panel de asistencia por grupo del detalle de evento (`/events/[id]`) pasa el grupo del actor cuando el viewer es un lead no-management (el super_admin sigue viendo todos).

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| Crear política RLS en `profiles` que filtre por grupo | Rompería las lecturas de enriquecimiento (noticias/preguntas/eventos) que dependen de `profiles_select_authenticated`; el filtrado por grupo se hace en la capa de aplicación. |
| Filtrar por grupo solo en la UI | Insuficiente: un lead podría leer la lista completa desde el cliente; la autorización se aplica también en las queries/acciones. |
| Query con cliente elevado (`service_role`) para `getWorkgroupMembers` | Rompe el patrón del proyecto (siempre cliente anónimo + RLS) y añade superficie de ataque. |
| Incluir ausencias en la ficha de detalle | Fuera del alcance de la tarea: solo turnos y asistencia. |

---

## Consecuencias

- La directiva ve el directorio completo; cada responsable ve únicamente su grupo; nadie más accede a `/members` (redirección a `/dashboard`).
- Un lead no puede leer turnos/asistencia de otros grupos ni por la UI ni por la API (doble barrera: app + RLS).
- El número total de políticas en `shift_assignments`/`attendance` aumenta en una cada una, todas aditivas y sin regresiones sobre las existentes.
- **Trade-off asumido:** `umsuka.profiles` sigue siendo legible por cualquier miembro activo vía API pública (la tabla no contiene email ni credenciales); el scoping por grupo para `/members` vive en la capa de aplicación. Ver condiciones de activación para revertirlo en la sección 3.
- 49 tests unitarios nuevos en `src/lib/members/__tests__/` (11 de schema, 15 de queries, 23 de autorización), todos pasando.

---

## Extension 2026-08-13 — Responsables de componente (música y baile)

### Contexto

La comparsa tiene dos cargos de responsabilidad adicionales: **responsable de música** y **responsable de baile**. Cada uno debe poder abrir `/members` y ver **solo los miembros de su componente** (pudiendo filtrar por grupo de trabajo dentro de él), y consultar la ficha de detalle (turnos/asistencia) de esos miembros. El cargo lo designa **únicamente el super admin** desde `/admin/users`; el resto de la directiva lo ve en solo lectura.

### Decisión

1. **Columna `component_lead_for` (TEXT nullable)** en `umsuka.profiles` con CHECK `('music','dance')`. Se eligió TEXT (no ENUM) para comparar directamente con el parámetro de la función helper sin cast — patrón más simple que el de `workgroup`, cuyo ENUM fue una decisión anterior.
2. **Índice único parcial** `idx_profiles_component_lead_for` → a lo sumo un responsable por componente. La UI captura la violación (23505) y la traduce a un mensaje amigable en español; no se hacen queries de pre-chequeo (evita carreras y lecturas extra).
3. **Función `umsuka.is_component_lead(text)`** — SECURITY DEFINER, `set search_path = umsuka, public`, `coalesce(..., false)`, `grant execute to authenticated`: mismo patrón que `is_workgroup_lead` (migración 0024).
4. **Políticas SELECT aditivas** `shift_assignments_select_component_lead` y `attendance_select_component_lead`: un responsable de componente lee turnos/asistencia de miembros cuyo `component_type` coincide con su cargo. Igual que en 0042: no se toca ninguna política existente (PostgreSQL OR-ea las políticas SELECT) y la política de `profiles` permanece intacta.
5. **Precedencia de alcance** en `src/lib/members/authorization.ts`: **management > componente > grupo**. `canViewMemberDetail(actor, { workgroup, componentType })` cambió su firma a un objeto con ambos atributos del miembro objetivo; un actor que sea a la vez lead de grupo y de componente queda regido por su cargo de componente.
6. **UI `/members`**: para el responsable de componente se bloquea el filtro de componente (banner «Mostrando solo los miembros del componente: X») y queda libre el filtro de grupo; para el lead de grupo es al revés (como ya existía). `NavLinkContext` gana `componentLeadFor` para mostrar el enlace «Directorio».
7. **Super admin**: `setComponentLeadAction(userId, component|null)` valida `role === "super_admin"`; el resto de la directiva ve el cargo en solo lectura (badge).

### Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| ENUM `component_lead` | TEXT + CHECK es suficiente; evita el cast ENUM↔text que obligó a la migración 0024 y añade complejidad de migración de tipos |
| Pre-chequear el responsable actual antes del UPDATE | Carrera de condiciones entre dos admins; el índice único parcial + manejo de 23505 es atómico y más simple |
| Extender la política SELECT de `profiles` para filtrar por componente | Mismo motivo que en la sección 3: rompería el enriquecimiento de noticias/preguntas/eventos |

### Consecuencias

- Precedencia de alcance **management > componente > grupo** aplicada en `resolveMemberScope` / `resolveMemberLocks` y revalidada en las queries (`isLeadOfGroup` / `isLeadOfComponent`): un actor que sea a la vez lead de grupo y de componente queda regido por su cargo de componente, y el filtro de grupo queda libre para él en `/members`.
- Una política SELECT aditiva más por tabla (`shift_assignments` / `attendance`); ninguna política existente se modifica ni elimina, y `profiles` conserva su política SELECT original.
- Sprint completo: **85 tests en total — 49 del alcance base + 36 de la extensión** (incluye el endurecimiento posterior al commit de documentación): 75 en `src/lib/members/__tests__` (11 schema + 20 queries + 44 autorización) y 10 en `tests/unit/lib/admin-set-component-lead.test.ts`, sin regresiones.

### Notas de seguridad aceptadas (escaneo security-champion — sin hallazgos HIGH)

El escaneo de seguridad de la extensión no reportó issues HIGH. Las notas restantes (dos MEDIUM y un LOW) se aceptan como trade-offs documentados:

1. **`set search_path = umsuka, public` en helpers `SECURITY DEFINER`** — `umsuka.is_component_lead(text)` replica el patrón pre-existente de `is_workgroup_lead` (migraciones 0013/0024). Aceptado: las funciones son `stable`, de solo lectura sobre `umsuka.profiles` (vía `auth.uid()`), sin escritura, y `search_path` fija `umsuka` en primer lugar. Es el patrón conocido y consistente del proyecto.
2. **`admin` puede escribir `component_lead_for` vía PostgREST** — la política UPDATE de `profiles` permite a management editar perfiles, mientras la app restringe la designación a `super_admin` (`setComponentLeadAction` valida `role === "super_admin"`). Aceptado como defensa en profundidad: el índice único parcial limita el impacto (a lo sumo un responsable por componente), un `admin` ya tiene capacidad equivalente sobre el resto de campos del perfil, y el scoping de `/members` se deriva siempre del actor de sesión (un valor incorrecto no expone datos ajenos). Endurecimiento futuro opcional: `REVOKE` a nivel de columna o guarda en el panel de `/admin/users`.
3. **LOW — lead con `workgroup = "ninguno"` tratado como no-lead** — comportamiento ya documentado en la sección 1: un lead sin grupo real no obtiene scope de trabajo y `resolveMemberScope` lanza `AuthorizationError`. Aceptado: es el comportamiento deseado (el cargo no confiere acceso a un grupo inexistente).

---

## Archivos

| Archivo | Cambio |
|---|---|
| `src/lib/members/authorization.ts` | CREATE — helpers puros de autorización |
| `src/lib/members/schema.ts` | CREATE — `memberFiltersSchema` + tipos |
| `src/lib/members/queries.ts` | CREATE — queries con cliente anónimo y scoping lead |
| `src/lib/members/__tests__/*.test.ts` | CREATE — 49 tests unitarios |
| `src/app/members/actions.ts` | CREATE — server actions |
| `src/app/members/page.tsx`, `member-filters.tsx` | CREATE — listado con filtros |
| `src/app/members/[id]/page.tsx` | CREATE — ficha de miembro |
| `src/components/layout/nav-links.ts`, `app-shell.tsx`, `sidebar.tsx`, `bottom-nav.tsx` | MODIFY — enlace «Directorio» |
| `src/lib/workgroups/queries.ts`, `src/app/events/[id]/page.tsx` | MODIFY — filtro por grupo para leads en panel de grupo |
| `supabase/migrations/20260101004200_member_detail_lead_reads.sql` | CREATE — políticas aditivas lead |
| `tasks/sprint-14-member-list.json` | CREATE — tarea del sprint |
| `tasks/plan-desarrollo-completo.md` | MODIFY — Sprint 14 marcado ✅ Ejecutado |
| `docs/DATABASE.md` | MODIFY — documentación |

### Archivos de la extensión (responsables de componente)

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101004300_component_lead_for.sql` | CREATE — columna + CHECK + índice único parcial + `is_component_lead` + políticas aditivas |
| `src/types/database.types.ts`, `src/types/auth.ts`, `src/lib/auth/session.ts` | MODIFY — `component_lead_for` / `componentLeadFor` |
| `src/lib/members/authorization.ts` | MODIFY — `MemberActor.componentLeadFor`, scope `component`, precedencia management > componente > grupo, `isLeadOfComponent`, nueva firma de `canViewMemberDetail` |
| `src/lib/members/schema.ts`, `queries.ts` | MODIFY — `componentLeadFor` en tipos/mapping + `getComponentMembers` |
| `src/app/members/actions.ts`, `page.tsx`, `member-filters.tsx`, `[id]/page.tsx` | MODIFY — scope de componente, banner y filtro bloqueado |
| `src/components/layout/nav-links.ts`, `app-shell.tsx`, `sidebar.tsx`, `bottom-nav.tsx` | MODIFY — `componentLeadFor` en el contexto de navegación |
| `src/lib/profiles/queries.ts` | MODIFY — `componentLeadFor` en `ProfileListItem`/`ProfileDetail` |
| `src/app/admin/users/actions.ts` | MODIFY — `setComponentLeadAction` (solo super admin, manejo de 23505) |
| `src/app/admin/users/member-component-lead-select.tsx` | CREATE — select de cargo en la tabla de `/admin/users` |
| `src/app/admin/users/page.tsx` | MODIFY — columna «Responsable» |
| `src/lib/members/__tests__/*.test.ts`, `tests/unit/lib/admin-set-component-lead.test.ts` | MODIFY/CREATE — 36 tests nuevos respecto al sprint base (75 en `src/lib/members` + 10 de la acción admin) |
