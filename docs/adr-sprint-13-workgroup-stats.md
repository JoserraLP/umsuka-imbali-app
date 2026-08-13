# ADR-013: Sprint 13 — Estadísticas para Responsables de Grupo

**Status:** Accepted · **Date:** 2026-08-13

---

## Context

Cada responsable de grupo de trabajo (`is_workgroup_lead`) necesitaba una sección de estadísticas **exclusiva de su grupo**: por cada miembro, número de turnos asignados, turnos marcados/asistidos, horas efectivas y porcentaje de asistencia. El `super_admin` debe poder ver las estadísticas de **todos** los grupos; el resto de roles, ninguna. Los datos deben reflejar la asistencia ya marcada en los turnos de trabajo de sprints anteriores (Sprint 5 — asistencia/ausencias, Sprint 8 — shifts, Sprint 12 — asignación por turnos y grupos).

Implementado en la rama `feature/sprint-13-workgroup-stats` (7 commits siguiendo `docs/git-conventions.md`). **Sin PR todavía**: el usuario realizará pruebas locales antes de publicarlo.

Requisitos:

- Página de estadísticas por grupo con tabla resumen (nombre, turnos, horas, % asistencia) y desglose por miembro (turno con evento, fecha, horas y tarea de barra).
- Enlace de navegación visible solo para `super_admin` y responsables de grupo.
- Seguridad: defensa en profundidad (helpers puros + validación Zod en server actions + guardas en páginas).

### Restricciones heredadas

- La RLS vigente de `umsuka.workgroup_attendance` (políticas SELECT aditivas `workgroup_attendance_select` y `workgroup_attendance_select_own_or_management`, migraciones 0019/0027) permite a **cualquier miembro activo leer sus propias filas y a `is_management()` leerlas todas**. No se modifica: el scoping de las estadísticas se aplica en la capa de aplicación, **más estricto** que la RLS.
- Los turnos (`shifts`) tienen `start_time`/`end_time` como `timestamptz` exactos; **no existe** columna de duración en horas.
- Los índices necesarios para las queries ya existen desde sprints anteriores: `idx_workgroup_attendance_workgroup`, `idx_workgroup_attendance_user_id`, `idx_workgroup_attendance_shift_id` y `UNIQUE (shift_id, user_id)` en `shift_assignments`.

---

## Decisión

### 1. Sin migración SQL — horas calculadas en runtime

**No se persiste `shifts.duration_hours`.** La duración de un turno se calcula en runtime con la función pura `shiftDurationHours(startTime, endTime)` (`src/lib/workgroups/stats.ts`): `Date.parse` de ambos extremos, guardas para fechas inválidas (`NaN`) y para `end <= start` (devuelve `0`), y diff en ms ÷ `3_600_000`.

Justificación:

- `start_time`/`end_time` ya son `timestamptz` exactos: persistir la duración duplicaría el dato con riesgo de drift (un cambio de horario del turno no sincronizaría la columna derivada) y obligaría a un backfill.
- Los índices existentes cubren las queries batch (`.eq("workgroup", …)` y `.in("id", …)`); no se necesita ninguno nuevo.
- Consecuentemente **no hay archivo SQL nuevo** en este sprint.

### 2. Regla de negocio (capa de agregación pura)

| Métrica | Definición |
|---|---|
| Turnos asignados | Nº de filas de `shift_assignments` del miembro. **Informativo**: no participa en el porcentaje. |
| Turnos marcados | Nº de filas de `workgroup_attendance` del grupo (por miembro). |
| Turnos asistidos | Marcados con `attended = true`. |
| Horas efectivas | `attended ? (hours_worked ?? duración del turno) : 0` (`computeEffectiveHours`). La barra nunca almacena `hours_worked`, por lo que **siempre** usa la duración del turno; un ausente cuenta `0` aunque tuviese `hours_worked`. |
| % asistencia | `asistidos / marcados × 100`, redondeado a 1 decimal; `null` si `marcados = 0` (la UI muestra «—»). |

Redondeos: horas a 2 decimales (por turno y total), % a 1 decimal. Orden de la tabla: `firstName` luego `lastName` (ascendente, `localeCompare`). El desglose por miembro (`computeMemberStatsDetail`) ordena por `startTime` descendente y usa fallbacks «Turno sin nombre» / «Evento desconocido» cuando faltan datos.

### 3. Autorización — `canViewGroupStats` (helper puro)

En `src/lib/workgroups/stats.ts`, `canViewGroupStats(actor, workgroup)` (interface `StatsActor { role, isWorkgroupLead, workgroup }`): acceso **solo** si `role === "super_admin"` **o** lead del grupo exacto (`isWorkgroupLead && workgroup coincide && workgroup !== "ninguno"`).

- **Más estricta que la RLS vigente**: un `admin` (que cumple `is_management()`) **no** ve estadísticas de ningún grupo; replica `is_super_admin`, no `is_management`. Un lead con `workgroup = "ninguno"` se trata como no-lead.
- Defensa en profundidad (3 barreras independientes):
  1. **Páginas** — guarda `canViewGroupStats(profile, group)` con `redirect("/dashboard")` (o `redirect("/auth/login")` sin sesión) y `notFound()` si `activeWorkgroupSchema.safeParse(group)` falla.
  2. **Server actions** — `activeWorkgroupSchema.safeParse` (`"ninguno"` queda fuera del enum, nunca llega a las queries → «Grupo no válido.»).
  3. **Queries** — `getGroupStats`/`getMemberStatsDetail` lanzan `AuthorizationError` **antes de consultar** si `!canViewGroupStats || workgroup === "ninguno"`; además, `getMemberStatsDetail` revalida que un lead pida un miembro de su propio grupo (`member.workgroup !== workgroup` → `AuthorizationError`) y devuelve `null` (→ `notFound()`) si el miembro no existe, sin filtrar información.

### 4. Arquitectura de capas

- **`src/lib/workgroups/stats.ts`** — funciones puras sin BD: `shiftDurationHours`, `computeEffectiveHours`, `canViewGroupStats`, `computeGroupStats`, `computeMemberStatsDetail` + tipos (`GroupMemberStat`, `GroupStats`, `MemberShiftStat`, `MemberStatsDetail`). Unidad de testeo central.
- **`src/lib/workgroups/stats-queries.ts`** — queries con cliente anónimo (nunca elevado):
  - `getGroupStats(actor, workgroup)` — máximo **4 consultas** (miembros del grupo, asistencias del grupo, turnos con `.in()` sobre los `shiftId` presentes, asignaciones con `.in()` sobre los `userId`), agregación **en memoria** vía `computeGroupStats`; sin N+1 (las consultas de turnos y asignaciones se omiten si no hay asistencias/miembros).
  - `getMemberStatsDetail(actor, workgroup, userId)` — mismo patrón: asistencia del miembro acotada al grupo, turnos `.in()`, eventos `.in()`, asignaciones.
- **`src/app/workgroups/actions.ts`** — server actions **delgadas** `getGroupStatsAction` / `getMemberStatsAction` con resultado `{ success, error }`: `requireAuthenticatedProfile`, Zod, delegan en stats-queries y traducen `AuthorizationError` al mensaje de error; miembro inexistente → `{ success: true, data: null }`.
- **Páginas server + AppShell**:
  - `/workgroups` — índice: `super_admin` ve **4 tarjetas** (una por grupo activo); un lead no-super-admin es redirigido directamente a `/workgroups/<su grupo>/stats`; el resto, a `/dashboard`.
  - `/workgroups/[group]/stats` — tabla resumen (nombre, turnos asignados, turnos asistidos, horas totales, % asistencia) con banners explicativos (horas de barra por duración; % sobre turnos marcados) y badge/volver solo para `super_admin`.
  - `/workgroups/[group]/stats/[userId]` — desglose por turno: resumen de 4 tarjetas + tabla con **turno, evento (enlazado), fecha, asistió, horas y tarea de barra**.
- **Nav** — enlace «Estadísticas» (`BarChart3`) en `nav-links.ts` visible solo para `super_admin` o `isWorkgroupLead && workgroup !== "ninguno"` (misma condición que `canViewGroupStats`).

### 5. Cobertura de pruebas

48 tests unitarios nuevos: **25 de funciones puras** en `tests/unit/lib/workgroups-stats.test.ts` (duración, horas efectivas, autorización, agregación, orden, redondeos, fallbacks) y **23 con mocks de Supabase** en `src/lib/workgroups/__tests__/stats-queries.test.ts` (autorización sin consultar, flujos felices, queries saltadas, errores de cada consulta, `null` para miembro inexistente, miembro fuera del grupo para lead). Cobertura de `stats.ts` y `stats-queries.ts`: **100 % líneas/funciones, 93,69 % ramas**. Lint, typecheck y build pasan; total de la suite: **471 tests**.

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| Columna `duration_hours` en `shifts` (con backfill) | Duplica un dato derivable de `start_time`/`end_time` (timestamptz exactos) con riesgo de drift; el cálculo en runtime es puro, testeable y no requiere migración ni índices nuevos. |
| % de asistencia sobre turnos asignados | Penalizaría turnos futuros aún sin marcar (siempre presentes en `shift_assignments`); el % se calcula sobre **turnos marcados** (los que tienen registro de asistencia). |
| `admin` como visor global (replicar `is_management()`) | Rompería la RLS: el SELECT de `workgroup_attendance` permite a management leer cualquier fila, pero el alcance de esta sección exige solo `is_super_admin`; un `admin` no vería datos de otros grupos por diseño. La capa de aplicación es deliberadamente **más estricta** que la RLS. |
| Filtros por rango de fechas | Fuera de alcance del sprint; actualmente las estadísticas cubren el histórico completo. Posible mejora futura sin cambio de esquema. |

---

## Consecuencias

### Positivas

- El `super_admin` ve las estadísticas de los 4 grupos activos; cada responsable ve únicamente su grupo; nadie más accede a `/workgroups*` (redirección a `/dashboard`).
- Sin cambios de base de datos: ni migraciones, ni política RLS, ni índices nuevos (los existentes ya cubren las queries batch).
- Regla de negocio y autorización replicadas en helpers puros con tests unitarios sin BD; agregación en memoria sin N+1 (máx. 4 consultas por detalle).
- Las horas de barra se calculan siempre por duración del turno, coherente con que la barra no almacena `hours_worked`.

### Seguridad (defensa en profundidad)

- La capa de aplicación es **más estricta que la RLS vigente**: ni `admin` ni `is_management()` obtienen estadísticas; solo `super_admin` o lead del grupo exacto pasan todas las barreras.
- **Sin datos expuestos entre grupos**: un lead no puede leer estadísticas de otro grupo ni por la UI (guardas + redirect), ni por server actions (Zod rechaza `"ninguno"`), ni por las queries (`AuthorizationError` lanzado **antes** de consultar; revalidación del grupo del miembro en el detalle).
- Miembro inexistente o acceso entre grupos en el detalle → `notFound()` / `data: null`: no se filtra información sobre la existencia de miembros.
- El enlace de navegación se oculta para los no autorizados (no solo se protege la ruta).
- **Trade-off aceptado:** la RLS de `workgroup_attendance` sigue permitiendo a `is_management()` leer filas de asistencia de todos los grupos vía API (PostgREST); la sección de estadísticas restringe el acceso por aplicación. Endurecimiento futuro opcional: endurecer las políticas SELECT de `workgroup_attendance` para replicar `is_super_admin` + lead del grupo exacto (requiere revisar los puntos de lectura de management antes).

### Riesgos / pendientes

- **Sin rango de fechas**: el histórico completo puede crecer; los filtros por período son una mejora futura documentada.
- **Turnos asignados informativos**: `shift_assignments` no distingue estado futuro de confirmación; la métrica no participa en el porcentaje (decisión deliberada).
- Sin PR creado todavía: el usuario probará en local desde la rama antes de publicarla.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `src/lib/workgroups/stats.ts` | CREATE — funciones puras (`shiftDurationHours`, `computeEffectiveHours`, `canViewGroupStats`, `computeGroupStats`, `computeMemberStatsDetail`) + tipos |
| `src/lib/workgroups/stats-queries.ts` | CREATE — queries batch con cliente anónimo y `AuthorizationError` |
| `src/lib/workgroups/__tests__/stats-queries.test.ts` | CREATE — 23 tests con mocks |
| `tests/unit/lib/workgroups-stats.test.ts` | CREATE — 25 tests de funciones puras |
| `src/app/workgroups/actions.ts` | CREATE — server actions delgadas `{ success, error }` |
| `src/app/workgroups/page.tsx` | CREATE — índice de grupos (solo `super_admin`; leads redirigidos; resto a `/dashboard`) |
| `src/app/workgroups/[group]/stats/page.tsx` | CREATE — tabla resumen del grupo |
| `src/app/workgroups/[group]/stats/[userId]/page.tsx` | CREATE — desglose por turno del miembro |
| `src/components/layout/nav-links.ts` | MODIFY — enlace «Estadísticas» (`BarChart3`) para `super_admin` y leads |
| `tasks/sprint-13-workgroup-stats.json` | CREATE — tarea del sprint (status `security-cleared`) |
| `package.json`, `package-lock.json` | MODIFY — devDependencies para la cobertura de tests |

> **Sin migración SQL y sin cambios en `docs/` existentes**: este sprint no añade ningún archivo en `supabase/migrations/` (decisión 1) y no toca otros documentos; `docs/DATABASE.md` queda sin cambios porque no hay cambios de esquema.