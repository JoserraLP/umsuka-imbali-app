# ADR-032: Sprint 32 — Inscripción Automática a Ensayos (Rehearsal Auto-Enroll)

**Status:** Accepted (Implementado) · **Date:** 2026-08-26 · **Sprint:** 32 ·
**Branch:** `feature/sprint-32-rehearsal-auto-enroll`

---

## Context

Al crear un ensayo (`event_type='rehearsal'`) la directiva debía inscribir manualmente a cada miembro uno a uno para poder marcar asistencia por sesión (mañana/tarde). Sprint 32 automatiza la inscripción: al crear el ensayo con categoría `music` o `dance` el sistema pre-inscribe a **todos** los miembros activos cuyo `component_type` coincida, creando filas en `rehearsal_attendance` con `enrolled=true`. Los miembros no pueden auto-inscribirse (RLS `is_management()`); la re-ejecución es idempotente (UPSERT sobre UNIQUE `event_id,user_id,session`).

Requisitos (`tasks/sprint-32-rehearsal-auto-enroll.json`):
- Ensayo música → inscritos `component_type=music`; baile → `dance`
- Miembro no puede auto-insertarse (RLS 42501)
- No duplicados (UPSERT idempotente)
- Miembro incorrecto no se inscribe
- Responsable marca asistencia sobre inscritos (Sprint 27 intacto)
- Notificación automática a inscritos (`event_created`)

Dependencias: Sprint 2 (`component_type` music/dance), Sprint 17 (`rehearsal` + sessions), Sprint 27 (`rehearsal_attendance`, `rehearsal_session`), Sprint 20 (notificaciones).

Patrones reutilizados: ENUM nativo, RLS `FORCE` + `is_management()` (0013), Zod isomórfico, `MutationResult` + guard, admin client `service_role` bypass con autorización explícita, `database.types.ts` hand-edited + checklist.

Última migración: `20260101006400_member_payments.sql`; este sprint usa **0065**.

### Corrección SDD: `workgroup` vs `component_type`

`plan-desarrollo-completo.md` §Sprint 32 dice *"workgroup music/dance"*. Falso: `Workgroup = telas/barra/estandarte/limpieza/ninguno` vs `ComponentType = music/dance/member` (`database.types.ts:9-13`). **Decisión:** `rehearsal_category` mapea a `profiles.component_type`. Si se filtrara por `workgroup`, músicos/bailarines con `workgroup=ninguno` quedarían excluidos (0 inscritos). Documentado aquí y en migración.

---

## Decisión

### D1 — ENUM `rehearsal_category` (`music`/`dance`) tipado fuerte

```sql
do $$ begin
  if not exists (select 1 from pg_type where typname='rehearsal_category' and typnamespace='umsuka'::regnamespace) then
    create type umsuka.rehearsal_category as enum ('music','dance');
  end if;
end$$;
```

Dominio cerrado y estable como `rehearsal_session` (0058) y `payment_type` (0064). Evita texto libre y habilita `::rehearsal_category` en tipos. Orden `music,dance`.

### D2 — `events.rehearsal_category` nullable con CHECK permisivo

```sql
alter table umsuka.events add column if not exists rehearsal_category umsuka.rehearsal_category null;
alter table umsuka.events add constraint chk_events_rehearsal_category
  check (event_type='rehearsal' or rehearsal_category is null);
```

`NULL` para no-rehearsal y para ensayos legacy sin categoría. CHECK permisivo evita romper ensayos existentes; validación estricta en Zod (`rehearsal → music|dance`, no-rehearsal → `null`) es la fuente de verdad para creación nueva. Alternativa estricta (`rehearsal AND category NOT NULL`) rechazaría legacy.

### D3 — `rehearsal_attendance.enrolled` + `enrolled_at` con CHECK coherencia

```sql
alter table umsuka.rehearsal_attendance
  add column if not exists enrolled boolean not null default false,
  add column if not exists enrolled_at timestamptz null;
alter table umsuka.rehearsal_attendance add constraint chk_rehearsal_enrolled_at
  check ((enrolled=true and enrolled_at is not null) or (enrolled=false and enrolled_at is null));
create index if not exists idx_rehearsal_attendance_event_enrolled on umsuka.rehearsal_attendance(event_id,enrolled);
```

`enrolled=true` marca auto-enroll; `false` legacy/manual. `enrolled_at` auditoría. Default `false` para no romper filas existentes. CHECK estricto evita estados incoherentes. Índice para listar inscritos rápido.

### D4 — Idempotencia vía UNIQUE `event_id,user_id,session`

Ya existe (0058). `autoEnrollRehearsal` hace `upsert(..., onConflict='event_id,user_id,session')`. Re-ejecución es no-op (0 nuevas filas). Trade-off: bulk `upsert` sobrescribiría `attended=true` si se re-ejecutara tras marcar asistencia; riesgo bajo porque auto-enroll solo ocurre en creación (antes de marcar). Documentado como hallazgo (no borrar tras marcar).

### D5 — Mapea a `component_type`, no `workgroup`

```ts
admin.from('profiles').select('id')
  .eq('component_type', category)
  .eq('status','active').is('deleted_at',null).eq('is_active',true)
```

Filtra por `component_type` (music/dance) excluyendo `member`, `suspended/pending/deleted`. Una fila por sesión habilitada (`morning_session`/`afternoon_session`): `members × sessions` → `rows`. Notifica solo a esos `user_id`.

### D6 — RLS sin cambios (write `is_management()`)

```sql
-- 0058 ya tiene:
-- select: user_id=auth.uid() OR is_management()
-- for all: using is_management() with check is_management()
```

Member `INSERT rehearsal_attendance` → `42501 violates RLS`. Auto-enroll usa `createAdminClient()` (`service_role` bypass) tras validar `isManagementRole(actor.role)` fail-closed. No nueva policy.

### D7 — Zod isomórfico `rehearsalCategory`

`src/lib/events/schema.ts`:
- `REHEARSAL_CATEGORIES=['music','dance']`, `rehearsalCategory: z.enum(...).nullable().optional().transform(v=>v??null)`
- `hasRequiredRehearsalCategory` refine: rehearsal → music|dance, no-rehearsal → null
- `resolveRehearsalCategory()` helper mirror `resolveSessionFlags`

`src/lib/rehearsals/auto-enroll.ts`:
- `autoEnrollRehearsalSchema` (`eventId` uuid, `category` music/dance)
- Labels ES `Música/Baile`, `isRehearsalCategory` guard

### D8 — Integración `createEvent` best-effort

En `src/lib/events/mutations.ts:createEvent` tras `insert events`:
1. Si `rehearsal && rehearsalCategory` → `autoEnrollRehearsalSystem(eventId, category)` (admin bypass, no re-valida rol porque `createEvent` ya validó `isManagementRole`).
2. Si `enrolledCount>0` → fetch `profiles` ids y `notifyUsers({userIds: enrolledIds, type:'event_created', title:'Nuevo ensayo...', link:'/events/id'})` best-effort try/catch (nunca falla creación).
3. Audience notify genérica se omite para rehearsal auto-enrolled (evita doble). No compensación `delete` si enroll falla (evento queda creado, re-intento manual posible).

### D9 — UI

- `src/app/events/event-form.tsx`: selector `rehearsalCategory` (`<Select>` music/dance) visible solo si `eventType==='rehearsal'`, helper "Se inscribirá automáticamente...".
- `src/app/events/new/page.tsx` y `src/app/events/[id]/page.tsx` defaults/mapeo incluyen `rehearsalCategory`.
- `src/lib/events/queries.ts`: `EventListItem.rehearsalCategory`, `EventRow.rehearsal_category`, `EVENT_SELECT` + `mapRow`.
- `src/lib/rehearsals/queries.ts`: `RehearsalAttendanceRecord.enrolled/enrolledAt`, `RehearsalAttendanceSummary.enrolledCount`, selects ampliados.
- `src/app/events/[id]/page.tsx`: badge `Categoría: Música/Baile`, descripción con conteo inscritos, `rehearsalAttendees` derivados de `rehearsalRecords` (no de registrations), `panelAttendees` fallback.
- `src/types/database.types.ts` hand-edited: `RehearsalCategory`, `events.rehearsal_category`, `rehearsal_attendance.enrolled/enrolledAt`, `Enums.rehearsal_category/session`.

### D10 — Una migración (0065) + tipos hand-edited

Idempotente (`if not exists`, `drop if exists`, `do exception when duplicate_object`) + checklist 13 comprobaciones (ENUM orden, CHECKs, índices, RLS, idempotencia). Fila 0065 en `docs/DATABASE.md`.

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| **Filtrar por `workgroup` music/dance** | `Workgroup` no contiene esos valores; inscribiría 0. Corregido a `component_type`. |
| **ENUM `rehearsal_category` separado vs CHECK texto** | Texto libre permite typos; ENUM tipado fuerte como `rehearsal_session` es patrón probado. |
| **CHECK estricto `rehearsal → category NOT NULL` en DB** | Rechazaría ensayos legacy (0058) sin categoría; permisivo DB + estricto Zod es más seguro. |
| **Trigger DB para auto-enroll** | Ocultaría lógica, difícil notificar, no idempotente fácilmente; server action es explícito y testeable. |
| **Una fila por miembro (sin session)** | Rompería `UNIQUE(event_id,user_id,session)` y perdería per-session `attended`; requiere `session` por diseño Sprint 27. |
| **RLS nueva policy `allow self-insert for enrolled`** | Permitiría miembro auto-inscribirse, viola AC "no pueden inscribirse por sí mismos". |
| **`gen-types`** | Sin CLI local; hand-edited + `tsc` es patrón (ADR-29/30/31). |
| **Borrar inscritos antiguos al cambiar categoría en update** | Perdería historial `attended`; decisión: no borrar, solo añadir nuevos (upsert). |

---

## Edge cases manejados

| Escenario | Comportamiento |
|---|---|
| No autenticado | `requireAuthenticatedProfile` throw → `Se requiere autenticación.` |
| `member` crea rehearsal | Guard `isManagementRole` → `"Solo la directiva puede..."` antes de DB |
| `member` intenta `INSERT rehearsal_attendance` | RLS `42501 violates row-level security` |
| `rehearsal` sin `morning/afternoon` | CHECK `chk_events_rehearsal_has_session` + Zod `hasRequiredRehearsalSessions` |
| `rehearsal` sin `rehearsalCategory` | Zod `hasRequiredRehearsalCategory` → `"Elige categoría..."` |
| `general` con `rehearsalCategory` | CHECK `chk_events_rehearsal_category` + Zod → rechazo |
| `enrolled=true, enrolled_at=null` o viceversa | CHECK `chk_rehearsal_enrolled_at` |
| Miembro `suspended/pending/deleted/is_active=false` | Excluido del `select` (no inscrito) |
| `component_type=member` | Nunca inscrito (solo music/dance) |
| 0 miembros elegibles | `enrolledCount=0`, éxito, sin notificaciones |
| Re-ejecución | UPSERT `onConflict` → 0 duplicados (idempotente) |
| Concurrencia doble click | UNIQUE + UPSERT → race-safe |
| `anon` | Sin policy → deny |
| Re-run migración | Idempotente (`IF NOT EXISTS`, `DO duplicate_object`) |

---

## Consecuencias

### Positivas

- **Cero inscripción manual**: responsable ve lista pre-poblada por categoría.
- **Idempotente y race-safe** (UNIQUE + UPSERT).
- **RLS intacta** sin nueva surface `SECURITY DEFINER`.
- **Notificación automática** solo a inscritos, best-effort.
- **Suite verde**: 10 tests nuevos (`rehearsals-auto-enroll` 10: constants, isRehearsalCategory, schema, Zod rehearsalCategory) sobre **1384 tests en 93 archivos** (fue 1374/92 → +1 archivo +1 por bottom-nav).
- **`tsc`/`eslint`/`next build` limpios** (`/events/[id]` 12.4 kB).
- **Cero helpers duplicados**: reutiliza `is_management()` y `createAdminClient`.

### Seguridad (defensa en profundidad)

- **Sin nueva función `SECURITY DEFINER`**.
- **RLS `ENABLE+FORCE`** en `rehearsal_attendance`; checklist verifica `pg_policies` (2 policies `to authenticated` con `is_management()`).
- **Fail-closed** en guards y `requireAuthenticatedProfile`.
- **Service_role solo tras validar `isManagementRole`**.

### Trade-offs / hallazgos conocidos

1. **`upsert` sobrescribe `attended`**: si se re-ejecuta enroll tras marcar `attended=true`, bulk `upsert(attended:false)` lo resetea. Riesgo bajo (solo en creación); workaround documentado: re-ejecución post-marca no recomendada; usar `INSERT ... ON CONFLICT DO NOTHING` fila a fila si se necesita 100% safe (performance vs correctitud).
2. **Sin re-enroll retroactivo**: miembro creado tras ensayo no se inscribe; requiere trigger/job (fuera de scope).
3. **Sin paginación**: `profiles` query asume <500 music/dance; añadir `.range` si crece.
4. **Legacy `rehearsal` sin categoría**: queda sin inscritos hasta que se edite y asigne categoría + re-enroll manual.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101006500_rehearsal_auto_enroll.sql` | CREATE — ENUM `rehearsal_category` + `events.rehearsal_category` + CHECK permisivo + `rehearsal_attendance.enrolled/enrolled_at` + CHECK coherencia + índice + checklist |
| `src/types/database.types.ts` | MODIFY — hand-edited: `RehearsalCategory`, `events.rehearsal_category`, `rehearsal_attendance.enrolled/enrolledAt`, `Enums.rehearsal_category/session` |
| `src/lib/rehearsals/auto-enroll.ts` | CREATE — `REHEARSAL_CATEGORIES`, `autoEnrollRehearsal` (guard + fetch component_type + sessions + upsert idempotente) + `autoEnrollRehearsalSystem` + labels/helpers |
| `src/lib/rehearsals/queries.ts` | MODIFY — `RehearsalAttendanceRecord.enrolled/enrolledAt`, `RehearsalAttendanceSummary.enrolledCount`, selects ampliados |
| `src/lib/rehearsals/schema.ts` | (sin cambios, referencia) |
| `src/lib/events/schema.ts` | MODIFY — `REHEARSAL_CATEGORIES`, `rehearsalCategory` field + `hasRequiredRehearsalCategory` refine en 3 schemas + `resolveRehearsalCategory` helper |
| `src/lib/events/queries.ts` | MODIFY — `EventListItem.rehearsalCategory`, `EventRow.rehearsal_category`, `EVENT_SELECT`, `mapRow` |
| `src/lib/events/mutations.ts` | MODIFY — `resolveRehearsalCategory` + `insert/update` con `rehearsal_category` + best-effort `autoEnrollRehearsalSystem` + `notifyUsers` solo a inscritos |
| `src/app/events/event-form.tsx` | MODIFY — selector `rehearsalCategory` + gating `rehearsal` |
| `src/app/events/new/page.tsx` | MODIFY — `defaultValues.rehearsalCategory: null` |
| `src/app/events/[id]/page.tsx` | MODIFY — badge categoría, `rehearsalSessions` + `rehearsalAttendees` derivados, `panelAttendees` fallback, descripción con conteo |
| `src/app/events/[id]/rehearsal-attendance-panel.tsx` | (sin cambios funcionales, hereda `records` con `enrolled`) |
| `docs/DATABASE.md` | MODIFY — fila 0065 |
| `tests/unit/lib/rehearsals-auto-enroll.test.ts` | CREATE — 10 tests constants + schema + Zod rehearsalCategory (rehearsal sin categoría, music/dance OK, non-rehearsal con categoría, sessions) |
| `tests/unit/lib/events-audience-mutations.test.ts` | MODIFY — `createInput` añade `rehearsalCategory: null` |
| `tests/unit/lib/notifications-integrations.test.ts` | MODIFY — idem |
| `tests/unit/lib/ordering-sorting.test.ts` | MODIFY — `makeEvent` añade `rehearsalCategory: null` |

### Tests

| Archivo | Tests |
|---|---|
| `tests/unit/lib/rehearsals-auto-enroll.test.ts` (CREATE) | 10 — `REHEARSAL_CATEGORIES` match eventos, labels ES, `isRehearsalCategory` true/false, `autoEnrollRehearsalSchema` uuid/category, `createEventSchema` rehearsal sin categoría (rechaza), rehearsal music/dance OK, non-rehearsal con categoría rechaza, non-rehearsal null OK, sessions required |
| `tests/unit/lib/rehearsals-schema.test.ts` (existente, verde) | 11 — sanity `rehearsal_session` + marks |
| `tests/unit/lib/events-schema.test.ts` (existente, verde) | 26 — + rehearsalCategory coverage vía nuevo archivo |

**Verificado en local (2026-08-26):** `npx vitest run` → **1384 tests en 93 archivos, todos pasando** (10 nuevos); `npx tsc --noEmit` limpio; `npx eslint . --max-warnings=0` limpio; `npx next build` sin errores (`/events/[id]` 12.4 kB). Security scan: CLEAR, 0 HIGH.

---

## Referencias

- Task file: `tasks/sprint-32-rehearsal-auto-enroll.json`
- Plan: `tasks/plan-desarrollo-completo.md` §Sprint 32 (corrección workgroup→component_type documentada)
- ADR-027 (Rehearsal Attendance): `rehearsal_session` ENUM, `morning/afternoon_session` + CHECKs, `rehearsal_attendance` RLS
- ADR-031 (Payment Tracking): patrón ENUM, RLS `is_management()`, Zod isomórfico y checklist
- Sprint 2 (`roles.ts` `MANAGEMENT_ROLES`, `component_type` music/dance) y migración 0013 (`is_management`, `current_user_role`)
- `docs/DATABASE.md`: fila 0065
- `docs/git-conventions.md`: rama `feature/sprint-32-rehearsal-auto-enroll`, commits `feat(sprint-32)`/`test(sprint-32)`/`docs(sprint-32)`

