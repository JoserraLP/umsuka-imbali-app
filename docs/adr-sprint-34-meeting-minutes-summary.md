# ADR-034: Sprint 34 — Actas de Reuniones y Resumen en Dashboard/Perfil

**Status:** Accepted (Implementado) · **Date:** 2026-08-30 · **Sprint:** 34 ·
**Branch:** `feature/sprint-34-meeting-minutes-summary`

---

## Context

Sprint 34 une dos bloques:

**(A) Actas de reuniones:** cada acta **siempre asociada 1:1 a un evento de tipo `reunion`** y es un **fichero (PDF/DOC/DOCX, máx. 10 MB)** subido a Supabase Storage bucket `meeting-minutes`. Solo la directiva/super_admin sube/reemplaza/elimina; todos los miembros autenticados ven si hay acta (sin descarga en esta fase).

**(B) Resumen visible para todos:** en **dashboard** y **perfil** cada miembro ve de un vistazo su **estado de pago (Sprint 31)**, **posición de baile (Sprint 33)** e **instrumento asignado (Sprint 24/33)**. Detalle económico completo solo para el propio usuario/directiva/super_admin; posición e instrumento son públicos entre miembros.

Requisitos (`tasks/sprint-34-meeting-minutes-summary.json`):
- Acta huérfana imposible (FK + trigger `event_type='reunion'`, UNIQUE event_id).
- Fichero privado en Storage, sin descarga aún.
- Solo directiva escribe (RLS `is_management()` + guard fail-closed).
- Un acta por evento (reemplazar = upsert).
- Dashboard 3 tarjetas (pago verde/rojo, posición, instrumento) + perfil ampliado.
- "Sin asignar"/"Pendiente" en lugar de error.

Dependencias: Sprint 2/21 (roles directiva), Sprint 17 (eventos + `reunion`), Sprint 31 (member_payments), Sprint 33 (dance_positions), Sprint 24 (instruments/musician_instruments), Sprint 16 (Storage).

Última migración: `20260101007000_fix_user_preferences_table.sql`; este sprint añade **0071**.

---

## Decisión

### D1 — Valor `reunion` en `umsuka.event_type` (distinto de `meeting`)

```sql
do $$ begin
  alter type umsuka.event_type add value if not exists 'reunion';
exception when duplicate_object then null; when others then
  begin alter type umsuka.event_type add value 'reunion'; exception when duplicate_object then null; end;
end $$;
```

`meeting` (reunión genérica existente) ≠ `reunion` (reunión formal con acta). Patrón `IF NOT EXISTS` + `DO duplicate_object` para compat PG sin `IF NOT EXISTS` (ver 0064/0065). Alternativa "reusar meeting" se descarta: semántica distinta y el CHECK de actas exige discriminación clara.

### D2 — Tabla `umsuka.meeting_minutes` separada 1:1

```sql
create table umsuka.meeting_minutes (
  id uuid pk default gen_random_uuid(),
  event_id uuid not null unique references events(id) on delete cascade,
  file_path text not null check (1-500),
  file_name text not null check (1-255),
  file_size int not null check (1..10485760),
  mime_type text not null check (pdf/doc/docx),
  uploaded_by uuid fk profiles set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

- `UNIQUE(event_id)` garantiza una acta por evento; `CASCADE` al borrar evento.
- No columna en `events`: permite metadata rica + trigger de validación + `updated_at` sin tocar `events`.
- Alternativa "columna `acta_file_path` en events" se descarta: mezcla responsabilidades y no permite índice/RSL dedicados ni evolución a múltiples ficheros si se requiere.

### D3 — Trigger `check_meeting_minutes_reunion()` fail-closed

```sql
create function umsuka.check_meeting_minutes_reunion() returns trigger as $$
  select event_type into v_type from events where id=NEW.event_id;
  if v_type <> 'reunion' then raise exception 'Solo eventos reunion pueden tener acta'; end if;
$$;
create trigger trg_check_meeting_minutes_reunion before insert or update of event_id on meeting_minutes ...
```

CHECK con subquery no permitido en `CREATE TABLE`; trigger `BEFORE INSERT/UPDATE OF event_id` es la defensa DB. Mutations espejan validación con `requireManagementGuard` + `event_type` check antes de `upsert`, y mapean excepción a mensaje es-ES.

### D4 — Storage bucket `meeting-minutes` privado + políticas

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meeting-minutes', 'meeting-minutes', false, 10485760, array['application/pdf', ...])
on conflict (id) do update set ...;
create policy select_authenticated on storage.objects for select to authenticated using (bucket_id='meeting-minutes');
create policy insert/update/delete_management on storage.objects ... using (is_management());
```

- `public=false` (privado), `file_size_limit=10 MB`, `allowed_mime_types=3`.
- `SELECT` para `authenticated` (ven metadata/objeto), `INSERT/UPDATE/DELETE` solo `is_management()`. Sin descarga presigned en Sprint 34 (solo metadata en UI), pero objeto ya es legible si se habilita descarga en futuro sin migrar.
- Alternativa "bucket público" se descarta: actas son sensibles.

### D5 — RLS `meeting_minutes`: `SELECT true`, `ALL is_management()`

```sql
alter table meeting_minutes enable row level security; force row level security;
create policy select_authenticated for select to authenticated using (true);
create policy write_management for all to authenticated using (is_management()) with check (is_management());
grant select,insert,update,delete on meeting_minutes to authenticated;
grant all on meeting_minutes to service_role;
```

- Lectura para todos los autenticados (ven que hay acta), escritura solo directiva. `service_role` bypass para admin client si se usa.
- Guards `requireManagementGuard` via `getCurrentProfile` + `isManagementRole` fail-closed en `mutations`/`uploadFileToStorage` (patrón `formation/mutations.ts`, `payments/mutations.ts`).

### D6 — Upload flujo: Storage primero, luego `meeting_minutes` upsert

`uploadFileToStorage(eventId, file)` valida directiva, `event_type='reunion'`, mime (fallback por extensión doc/docx), genera `filePath = ${eventId}/${Date.now()}-${rand}.${ext}`, hace `admin.storage.from('meeting-minutes').upload(filePath, file)` con `upsert:false`. Luego `uploadMinutes({eventId, filePath, fileName, fileSize, mimeType})` hace `upsert(..., onConflict='event_id')` con `uploaded_by=profile.id`. `deleteMinutes` borra fila y best-effort `admin.storage.remove([file_path])`.

### D7 — Capa `lib/meetings` isomórfica Zod

`schema.ts`: `ALLOWED_MIME_TYPES`, `MAX_FILE_SIZE=10MB`, `uploadMinutesSchema` (eventId uuid + fileName 1-255 + fileSize 1..10MB + mime enum + filePath 1-500), `validateFile` con fallback extensión, `formatFileSize`.

`queries.ts`: `getMinutesByEvent(eventId)`, `getAllMinutes()`, `getReunionEvents({search,fromDate,toDate,limit,offset})` — lista `events where event_type='reunion'` ordenados `event_date desc`, left join con `meeting_minutes` en JS (2 queries, merge por `event_id`).

`mutations.ts` + `actions.ts` thin con `revalidatePath('/events','/actas')`.

### D8 — Capa `lib/summary` agregación en paralelo

`getMemberSummary(userId)` dispara en `Promise.all`:
- `member_payments` (order year/month desc) → `isPaidForMonth(payments, currentYear, currentMonth)` para `al_dia` vs `pendiente`. Reusa helper puro de `lib/payments/queries.ts` (testeable).
- `dance_positions` left join `dance_formations!inner(name)` donde `member_id=userId limit 1` → `Fila X — Asiento Y`.
- `musician_instruments` join `instruments!inner(name,category)` + fallback `instrument_assignments where unassigned_at is null` (legacy Sprint 24) + enrich best-effort por `instruments`.

Sin nueva migración: reutiliza tablas 0064/0067. Privacidad: `payment.detail` completo solo se muestra en perfil propio/directiva (UI decide); posición e instrumento son públicos.

### D9 — UI

- **Acta en evento:** `src/components/meetings/MeetingMinutesSection.tsx` (client, `useTransition`) muestra estado acta disponible/sin acta, metadata (nombre, tamaño, fecha), `Badge "Acta disponible"` + nota "descarga próximamente". Solo `canManage=isManagementRole(profile.role)` ve uploader `Input type=file accept .pdf,.doc,.docx` + botón Subir/Reemplazar y botón Eliminar con `confirm`. Errores es-ES, `formatFileSize`.

- **Event detail:** `src/app/events/[id]/page.tsx` añade `isReunion`, fetch `getMinutesByEvent` best-effort, render `MeetingMinutesSection` tras `PaymentEligibility`. `EVENT_TYPE_LABELS` añade `reunion: "Reunión con acta"`.

- **Listado `/actas`:** `src/app/actas/page.tsx` (server) lista `getReunionEvents` con filtros `q/from/to` vía `searchParams`, form GET, badges `Con acta` (default) vs `Sin acta` (outline) + metadata fichero. Sin descarga.

- **Dashboard:** `src/app/dashboard/page.tsx` paralela `getMemberSummary(profile.id).catch=>null`, pasa a `DashboardContent` que renderiza `MemberSummaryCards compact` bajo banner bienvenida, antes de Notificaciones.

- **Perfil:** `src/app/profile/page.tsx` paralela `getMemberSummary`, renderiza `Card Resumen` con `MemberSummaryCards` (no compact) tras `PaymentStatusCard`.

- **Nav:** `src/components/layout/nav-links.ts` añade `{href:"/actas", label:"Actas", icon:FileText}` visible para todos.

- **Listados con labels:** `src/app/calendar/page.tsx`, `src/app/events/page.tsx`, `src/app/events/event-form.tsx` añaden `reunion` a `EVENT_TYPE_LABELS` + estilos teal.

### D10 — Tipos + una migración

`src/types/database.types.ts` hand-edited: `EventType` añade `"reunion"`, nueva tabla `meeting_minutes` con Relationships; `supabase/migrations/20260101007100_meeting_minutes.sql` idempotente + checklist 13 puntos + comentarios `pg_description`; `docs/DATABASE.md` fila 0071.

---

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Reusar `meeting` para actas | Mezcla reunión genérica con reunión con acta; trigger no discriminaría y el listado `/actas` filtraría `meeting` con ruido. |
| Columna `acta_file_path` en `events` | Acopla metadata a `events`, sin `UNIQUE` dedicado ni `uploaded_by`, difícil evolucionar a histórico. |
| Trigger `AFTER` vs `BEFORE` | `AFTER` ya habría insertado; `BEFORE` es fail-closed y evita fila huérfana. |
| Bucket público | Actas sensibles; privado + RLS Storage es correcto. |
| `getMemberSummary` con `SELECT *` + join DB | Heterogéneo (payments, positions, instruments) sin relación FK cruzada; 3 queries en paralelo + merge JS es más simple y sigue patrón `formation/queries.ts`. |
| Mostrar importe exacto a todos | Viola privacidad financiera; se muestra `Al día hasta MM/YYYY` genérico a otros, detalle solo propio/directiva. |
| Descarga inmediata | Requiere URL firmada + política `storage.objects` download; fuera de alcance Sprint 34 (solo metadata). |

---

## Consecuencias

- Positivo: invariante DB 1:1 acta-reunión, RLS estricta, validación espejada, UI accesible sin nuevas deps, resumen reutiliza sprints previos sin migración extra, tipos hand-edited coherentes, migraciones idempotentes.
- Negativo: `getMemberSummary` hace 4 queries en paralelo (3 + legacy fallback) por usuario; para `/members` listado masivo no se usa (solo dashboard/perfil individual). Legacy fallback hace fetch extra `instruments` secuencial si hay `instrument_assignments` sin `musician_instruments`.
- Riesgo: `uploadFileToStorage` genera `filePath` con timestamp+rand; colisión improbable (`upsert:false`). Reemplazar acta deja fichero huérfano en Storage si falla `remove` (best-effort, no bloquea borrado DB).

---

## Edge cases y trade-offs

- Evento no reunion → `uploadMinutes` rechaza con `"Solo eventos de tipo reunión con acta..."` (guard + trigger DB).
- Fichero >10 MB o mime no permitido → Zod `MAX_FILE_SIZE` + CHECK `mime_type IN (...)` + `validateFile` fallback extensión.
- Re-ejecutar upload (reemplazar) → `upsert onConflict event_id` sobrescribe `file_path/name/size/mime` y `uploaded_by/updated_at`; fichero anterior queda huérfano en bucket (no borrado automático, best-effort en `deleteMinutes`).
- Evento sin acta → UI muestra "Sin acta" + uploader solo para directiva; resto ve estado vacío (no error).
- Miembro sin pago/posición/instrumento → `getMemberSummary` devuelve `Sin asignar`/`Pendiente` con subqueries nulas (no throw).
- `anon` SELECT → `0 rows` (FORCE RLS sin policy anon).

---

## Verificación

Checklist idempotente en migración `20260101007100` (13 puntos): `event_type reunion`, `meeting_minutes` columnas/CHECKs/UNIQUE/CASCADE, índices, triggers `updated_at` + `check_reunion`, `RLS ENABLE+FORCE` + 2 policies, grants, bucket `meeting-minutes` privado 10 MB 3 mime + 4 storage policies, re-run idempotente (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `ON CONFLICT`).

---

## Cambios

- `supabase/migrations/20260101007100_meeting_minutes.sql` — CREATE.
- `src/types/database.types.ts` — `EventType "reunion"` + tabla `meeting_minutes`.
- `src/lib/meetings/schema.ts` — Zod + constantes + helpers.
- `src/lib/meetings/queries.ts` — `getMinutesByEvent`, `getAllMinutes`, `getReunionEvents`.
- `src/lib/meetings/mutations.ts` — `uploadMinutes`, `deleteMinutes`, `uploadFileToStorage` con `requireManagementGuard`.
- `src/lib/meetings/actions.ts` — `uploadMeetingMinutesAction`, `deleteMeetingMinutesAction` con `revalidatePath`.
- `src/lib/summary/queries.ts` — `getMemberSummary`, `getMemberSummaries` (agrega payments + dance_positions + musician_instruments/legacy).
- `src/lib/events/schema.ts` — `EVENT_TYPES` añade `reunion`.
- `src/components/meetings/MeetingMinutesSection.tsx` — estado acta, uploader, mensajes es-ES.
- `src/components/summary/MemberSummaryCards.tsx` — 3 tarjetas pago/posición/instrumento + badges.
- `src/app/actas/page.tsx` — listado reuniones con filtros y badge con/sin acta.
- `src/app/events/[id]/page.tsx` — fetch acta si reunion + embed `MeetingMinutesSection`.
- `src/app/dashboard/page.tsx` + `src/app/dashboard/dashboard-content.tsx` — `getMemberSummary` + `MemberSummaryCards compact`.
- `src/app/profile/page.tsx` — `getMemberSummary` + `Card Resumen`.
- `src/components/layout/nav-links.ts` + `src/app/calendar/page.tsx` + `src/app/events/page.tsx` + `src/app/events/event-form.tsx` — labels `reunion`.
- `tests/unit/lib/meetings-schema.test.ts` — 5 tests.
- `tests/unit/lib/summary-queries.test.ts` — 3 tests reuse `isPaidForMonth`.
- `tests/unit/components/bottom-nav.test.tsx` — ajusta 20→21 y 10→11 por `/actas`.
- `docs/DATABASE.md` — fila 0071 (pendiente push).

Todos los tests (`npx vitest run` 1415), `tsc --noEmit` y `eslint` limpios, `next build` 39 páginas (nueva `/actas`).

---

## Referencias

- `tasks/sprint-34-meeting-minutes-summary.json`
- `tasks/plan-desarrollo-completo.md` §Sprint 34
- `supabase/migrations/20260101006400_member_payments.sql` (isPaidForMonth reuse)
- `supabase/migrations/20260101006700_dance_formation_instruments.sql` (positions)
- `src/lib/instruments/*` (legacy assignments) y `src/lib/formation/*` (positions)

