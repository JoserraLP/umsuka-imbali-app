# ADR-038: Sprint 38 — Nuevo Año de Carnaval (Reset + Copia de Seguridad)

**Status:** Accepted (Implementado) · **Date:** 2026-08-30 · **Sprint:** 38 ·
**Branch:** `feature/sprint-38-new-carnival-year`

---

## Context

La comparsa trabaja por ciclos anuales. Al cerrar un año de carnaval la directiva necesita **archivar el año anterior completo** (estadísticas, formaciones, preguntas, miembros, pagos, asistencias, turnos, votaciones, eventos, instrumentos, dinero) y **empezar el nuevo año a 0** sin borrar el histórico ni los perfiles. El histórico debe ser consultable por secciones y descargable como backup JSON en Storage, y el reset debe ser transaccional (si falla la copia, no se archiva).

Requisitos (`tasks/sprint-38-new-carnival-year.json`):
- Directiva/super_admin inicia nuevo año desde `/admin/carnival` con doble confirmación (escribir AÑO).
- Archiva año activo (`status=archived`, `end_date=now()`) y crea copia completa en `carnival_year_snapshots` + `carnival-backups/<year>.json`.
- Contadores nuevo año a 0 (asistencias, pagos, posiciones vacías, instrumentos, stats) sin borrar `profiles`.
- Histórico en `/admin/carnival/history` por secciones solo lectura + descarga.
- Miembro normal solo ve año activo.
- Rollback si falla snapshot.

Dependencias: Sprint 5/11/13/14/15/17/24/28/29/31 + roles directiva.

Última migración: `20260101007100_meeting_minutes.sql`; este sprint añade **0072**.

---

## Decisión

### D1 — Tablas `carnival_years` + `carnival_year_snapshots`

```sql
create type carnival_year_status as enum ('active','archived');
create table carnival_years (
  id uuid pk default gen_random_uuid(),
  year int unique check (2000-2100),
  label text check (1-200),
  start_date date not null,
  end_date date check (end_date >= start_date),
  status carnival_year_status default active,
  created_by uuid fk set null,
  created_at timestamptz default now()
);
create unique index uniq_active where status='active';

create table carnival_year_snapshots (
  id uuid pk,
  carnival_year_id uuid fk cascade,
  snapshot_type text check (1-100),
  data jsonb not null,
  created_at timestamptz default now(),
  unique (carnival_year_id, snapshot_type)
);
```

- `year` UNIQUE 2000-2100 evita duplicados; `partial unique active` garantiza un solo activo (validado en app, no CHECK deferrable).
- `snapshots` una fila por sección (`members`, `events`, `questions`, `votings`, `payments`, `attendance`, `rehearsal_attendance`, `shifts`, `formations`, `instruments`, `transactions`, `stats`) con `data jsonb`. `UNIQUE(year_id,type)` idempotente via `upsert onConflict`.
- Alternativa "una tabla snapshot con todo en un jsonb único" descartada: por secciones permite query parcial y vista por secciones sin cargar todo.

### D2 — Columna `carnival_year_id` nullable en tablas anuales

```sql
alter table events add column carnival_year_id uuid fk set null;
alter table member_payments add column carnival_year_id uuid fk set null;
alter table dance_formations add column carnival_year_id uuid fk set null;
alter table transactions add column carnival_year_id uuid fk set null;
```

- Nullable para no romper datos legacy (NULL = año legacy/activo inicial). Backfill: tras crear año inicial 2026, `update ... set carnival_year_id = v_year_id where carnival_year_id is null`.
- Alternativa "migrar todo a NOT NULL" rechaza legacy; nullable + filtro por año activo en `dashboard` es más seguro.
- Otras tablas (attendance, shifts) quedan con `year_id` implícito vía `events.carnival_year_id` (no columna directa) para evitar proliferación de FKs; snapshots cubren su histórico sin FK.

### D3 — Bucket `carnival-backups` privado

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('carnival-backups','carnival-backups', false, 52428800, array['application/json'])
on conflict do update;
policy select/insert/update/delete on storage.objects where bucket_id='carnival-backups' and is_management();
```

- Privado 50 MB json, solo `is_management()` (histórico solo directiva). Full backup `year.json` contiene `{year,label,yearId,createdAt,createdBy,sections}`.

### D4 — RLS

```sql
carnival_years: SELECT true (todos ven año activo), ALL is_management();
carnival_year_snapshots: SELECT is_management(), ALL is_management();
```

- Member `SELECT snapshots` → 0 rows (42501). Member ve `years` pero no histórico. Directiva ve todo.

### D5 — Snapshot: `lib/carnival/year.createSnapshot(yearId)`

- Guard `isManagementRole` fail-closed.
- `admin.from(table).select` best-effort por cada tabla (profiles, events, questions, votings, member_payments, attendance, rehearsal_attendance, shifts, dance_formations, instruments, transactions) + `stats` count.
- `sections` map por `SNAPSHOT_TYPES` (12 tipos).
- Loop `upsert(carnival_year_snapshots, onConflict year_id+type)` + `admin.storage.upload(carnival-backups/<year>.json, Blob json, upsert:true)`.
- Si cualquier `upsert` falla → return error, no archiva.

### D6 — Nuevo año: `startNewYear(label,startDate,confirmText)`

1. Valid `confirmText === "AÑO"` (case-insensitive).
2. `getActiveYear` → `snap = createSnapshot(active.id)` must succeed else rollback (no archiva).
3. `update carnival_years set status='archived', end_date=now() where id=active.id`.
4. `insert carnival_years (year=max+1, label, start_date, status='active')`.
5. Si paso 4 falla → re-activar `active` (`status='active', end_date=null`) (rollback manual).
6. Reset counters: no `DELETE`; nuevo año empieza con `carnival_year_id=newId` vacío (nuevos inserts usarán nuevo id; queries filtran por activo si se desea).

### D7 — Lib/carnival isomórfico

- `schema.ts`: `CARNIVAL_YEAR_STATUSES`, `createCarnivalYearSchema` (year 2000-2100, label 1-200, start_date valid), `startNewYearSchema` (label, start_date, confirmText), `SNAPSHOT_TYPES` (12).
- `queries.ts`: `getActiveYear`, `getCarnivalYears`, `getYearById`, `getSnapshotsByYearId`, `getSnapshotSection`.
- `year.ts`: `createSnapshot`, `startNewYear` con admin bypass + guard.
- `actions.ts`: thin `createCarnivalYearAction`, `startNewCarnivalYearAction`, `createSnapshotAction` con `revalidatePath`.

### D8 — UI

- `/admin/carnival` (solo directiva): card año activo + `/admin/carnival/history` link + `CarnivalYearForm` (label, start_date, confirm AÑO, Button disabled hasta `confirmText==="AÑO"`, describe qué se archiva).
- `/admin/carnival/history?yearId=...`: lista años archivados, selector año, grid 2 col de snapshots por tipo con Badge count + `<details>` JSON (4000 char truncado) + nota Storage path.
- `nav-links.ts`: `{href:"/admin/carnival", label:"Año Carnaval", icon:PartyPopper, showFor isManagement}`.
- `bottom-nav.test.tsx`: 21→22 para super_admin (carnival solo management).

### D9 — Tipos + una migración

Hand-edited `database.types.ts`: `CarnivalYearStatus`, `carnival_years`, `carnival_year_snapshots`, `carnival_year_id` en 4 tablas + Enums. Migración 0072 idempotente + checklist 10 puntos.

---

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Snapshot único jsonb gigante | No permite consulta parcial por sección ni vista por tabs; 12 filas es más flexible. |
| `carnival_year_id NOT NULL` + migración masiva obligatoria | Rompería legacy; nullable + backfill inicial es más seguro. |
| Borrar datos al reset (DELETE) | Pierde histórico; requisito es conservar. |
| Trigger DB para snapshot | Oculta lógica, no notifica Storage, difícil rollback; server action explícito y testeable. |
| Bucket público | Histórico sensible; privado + RLS Storage correcto. |
| Usar `profiles.carnival_year_id` | Perfiles no se borran ni resetean; snapshot de `profiles` por año es suficiente. |

---

## Consecuencias

- Positivo: histórico completo por secciones, RLS estricta, transaccional con rollback, UI clara, sin borrar perfiles, snapshots + Storage redundancia, tests 5 nuevos.
- Negativo: `carnival_year_id` solo en 4 tablas; filtrado anual completo requiere join vía events para attendance/shifts (no directo). Nuevo año no vacía automáticamente `dance_positions` físicas (quedan con old year_id); UI debe filtrar por `formation.carnival_year_id` para mostrar vacío.
- Trade-off: `nextYear = max(year)+1` vs usar `label` year; se usa max+1 para evitar colisión si directiva elige label no numérico.

---

## Edge cases

- Sin año activo → `startNewYear` error "No hay año activo".
- ConfirmText != AÑO → guard error antes de DB.
- `createSnapshot` falla (storage quota) → `startNewYear` no archiva, mensaje "Fallo al crear copia... El año no se ha archivado."
- `insert new year` falla (year duplicate) → re-activa old year.
- Member intenta `/admin/carnival` → redirect `/dashboard`.
- Member `SELECT snapshots` → 0 rows (RLS).
- Re-run migración → idempotente (IF NOT EXISTS, ON CONFLICT, duplicate_object).

---

## Verificación

Checklist 0072: ENUM, tablas, UNIQUE active, snapshots UNIQUE, columnas FK, backfill 2026, RLS 2+2 policies, grants, bucket 50MB json + 4 policies, re-run idempotente. `tsc`/`eslint`/`next build` limpios (43 páginas con `/admin/carnival` + `/actas`), `vitest` 1420/97.

---

## Cambios

- `supabase/migrations/20260101007200_carnival_year.sql` — CREATE.
- `src/types/database.types.ts` — CarnivalYearStatus + 2 tablas + 4 FK cols.
- `src/lib/carnival/schema.ts` — Zod + SNAPSHOT_TYPES.
- `src/lib/carnival/queries.ts` — 5 queries.
- `src/lib/carnival/year.ts` — createSnapshot + startNewYear.
- `src/lib/carnival/actions.ts` — 3 actions.
- `src/app/admin/carnival/page.tsx` — año activo + form.
- `src/app/admin/carnival/carnival-year-form.tsx` — client form AÑO.
- `src/app/admin/carnival/history/page.tsx` — histórico por secciones.
- `src/components/layout/nav-links.ts` — Año Carnaval link.
- `tests/unit/lib/carnival-schema.test.ts` — 5 tests.
- `tests/unit/components/bottom-nav.test.tsx` — 21→22.
- `docs/adr-sprint-38-new-carnival-year.md` — este ADR.
- `tasks/sprint-38-new-carnival-year.json` — task.

---

## Referencias

- `tasks/sprint-38-new-carnival-year.json`, `plan §Sprint 38`
- `supabase/migrations/20260101007100_meeting_minutes.sql` (Storage RLS patrón)
- `src/lib/formation/year.ts` (rollback patrón), `src/lib/payments/queries.ts` (isPaidForMonth reuse)

