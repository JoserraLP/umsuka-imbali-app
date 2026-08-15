# ADR-017: Sprint 17 — Eventos: Mejora de Registro y Gestión + Onboarding de Grupo de Trabajo

**Status:** Accepted · **Date:** 2026-08-15

---

## Context

La gestión de eventos necesitaba completarse en dos frentes:

1. **Eventos**: la página de detalle solo mostraba fecha, descripción y capacidad; faltaban lugar (`location`), imagen (`image_url`) y fecha límite de inscripción (`registration_deadline`), así como un hilo de comentarios y una **lista de espera** (waitlist) para cuando el evento está lleno o el deadline ha pasado. Hoy, el trigger `check_event_capacity` (migración 0016) revienta con un error `capacity` al intentar registrarse en un evento lleno — el flujo debía **caer a la lista de espera en lugar de fallar**.
2. **Onboarding de grupo de trabajo**: la columna `workgroup` de `umsuka.profiles` (Sprint 2) podía ser `NULL` o `'ninguno'`, y no existía ningún mecanismo que obligara a elegir grupo. Un miembro nuevo (o uno al que el super admin quita el grupo) podía usar la app sin grupo, con el consecuente impacto en la visibilidad de eventos por grupo, turnos y paneles de asistencia.

Implementado en la rama `feature/sprint-17-events-enhancement` (siguiendo `docs/git-conventions.md`). **Sin PR todavía:** los cambios están en el working tree de la rama, pendientes del pipeline estándar (commit/PR/escaneo security-champion; la tarea `tasks/sprint-17-events-enhancement.json` figura con status `security-cleared`).

Requisitos:

- Eventos con capacidad y deadline; miembros en lista de espera con **posición visible** cuando está lleno o cerrado.
- Página `/events/[id]` con fecha, lugar, imagen, aforo, deadline y estado del registro del usuario.
- Comentarios en eventos: cualquier miembro activo comenta; autor y management borran.
- Onboarding obligatorio en el primer login: elegir grupo antes de usar la app; modificable desde `/profile` y por el super admin desde `/admin/users`.
- Seguridad: defensa en profundidad (validación en servidor + RLS + helpers puros).

### Restricciones heredadas

- `umsuka.check_event_capacity` (migración 0016) rechaza inserts por encima de `capacity` con un error cuyo mensaje contiene `capacity`; **no se modifica** (sigue como backstop atómico), el flujo de aplicación lo convierte en waitlist.
- `umsuka.profiles_component_type_requires_workgroup` (migración `20260101004100_component_type_requires_workgroup.sql`, con cabecera 0042) es `NOT VALID`: exige grupo real para `music`/`dance`, pero las filas legacy no fueron validadas en su día.
- El patrón de grants `service_role` para clientes admin viene documentado en las migraciones 0030/0033.
- El proyecto no usa `next/image` con `remotePatterns`; `next.config.ts` no se toca.

---

## Decisión

### 1. Migraciones SQL (0044–0047)

| Migración | Contenido |
|---|---|
| `20260101004400_events_metadata.sql` | Columnas aditivas nullable en `umsuka.events`: `registration_deadline timestamptz`, `location text`, `image_url text`. CHECKs: `chk_events_registration_deadline_after_created` (deadline posterior a `created_at`, o NULL) y `chk_events_image_url_http` (URL `^https?://[^[:space:]]+$`, espejo del Zod del cliente). Índice `idx_events_registration_deadline`. |
| `20260101004500_event_comments.sql` | Tabla `umsuka.event_comments` (id, `event_id` FK cascade, `user_id` FK cascade, `body` con CHECK no vacío, `created_at`) + índices por `event_id`/`user_id`. RLS: SELECT `is_active_member`, INSERT propia (`user_id = auth.uid()`), DELETE propia o `is_management()` (moderación). **Sin política UPDATE — los comentarios son inmutables.** |
| `20260101004600_event_waitlist.sql` | Enum `umsuka.waitlist_status` (`waiting`, `promoted`, `declined`, `removed`, creado idempotentemente con `do $$ … exception when duplicate_object`), tabla `umsuka.event_waitlist` con `UNIQUE(event_id, user_id)`, check `position > 0` y `promoted_at` nullable. Índices `(event_id, position)` y `(event_id, user_id)`. Triggers de posición race-safe (ver decisión 2). RLS: SELECT propia o management, INSERT propia, UPDATE management, DELETE propia o management. Grants `service_role` explícitos (patrón 0030/0033). |
| `20260101004700_workgroup_onboarding_defaults.sql` | Backfill `workgroup = 'ninguno'` **solo** para `component_type = 'member'` con `workgroup is null`; fail-fast con `raise exception` claro si queda alguna fila `music`/`dance` sin grupo (respetando `profiles_component_type_requires_workgroup`, que rechazaría `'ninguno'` con 23514 y abortaría la migración a medias); `ALTER COLUMN ... SET NOT NULL` + `set default 'ninguno'`; reescritura de `create_emailless_profile` v3 (normaliza `NULL`/`''`/`'ninguno'` → `'ninguno'`, nunca inserta NULL, y lanza 23514 con mensaje claro para `music`/`dance` sin grupo) + re-grant de execute a `service_role`. |

### 2. Waitlist con posición gestionada íntegramente por la BD (race-safe)

La posición **no se calcula en la capa de aplicación**: dos triggers `SECURITY DEFINER` (patrón de `search_path` del proyecto) la mantienen correcta bajo concurrencia:

- `assign_waitlist_position()` (BEFORE INSERT) — hace `select 1 from umsuka.events where id = new.event_id for update` (lock de la **fila del evento**, serializando joins concurrentes del mismo evento) y asigna `max(position) + 1`.
- `renumber_waitlist_after_delete()` (AFTER DELETE) — desplaza cada posición posterior `- 1`, manteniendo la cola **gapless**.

La promoción automática tras una baja usa el cliente `service_role` (`promoteNextFromWaitlist`): un miembro que se da de baja **no** puede ni debe ejecutar la promoción bajo su propia RLS (solo puede borrar su fila de `event_registrations`), así que el flujo `unregisterFromEvent` + `promoteNextFromWaitlist` ocurre en el servidor con el cliente admin. El cliente admin **nunca borra**: solo `SELECT`/`INSERT`/`UPDATE` sobre `event_waitlist` y `SELECT`/`INSERT` sobre `event_registrations` (grants mínimos documentados en la migración 0046). Una promoción fallida por entrada (evento lleno, duplicado, …) se loguea y se salta, sin romper la cascada ni la baja original (la baja nunca falla por un fallo de promoción).

Además, `setWaitlistEntryStatus(..., "promoted")` (gestión manual del panel) **inserta primero** en `event_registrations` y solo después marca la entrada como `promoted` con `promoted_at`; un duplicado (23505) se traduce a «Ese miembro ya está inscrito en el evento».

### 3. Validación de capacidad/deadline en servidor (defensa en profundidad)

RLS **no basta**: las políticas de `event_waitlist` no saben si el evento está lleno. Por eso `joinWaitlist` y `registerForEvent` leen la fila del evento (`capacity` + `registration_deadline`) y el conteo exacto de `event_registrations` antes de decidir:

- `registerForEvent`: si `count >= capacity` o el deadline ha pasado → `joinWaitlist` (devolviendo `status: "waitlisted"` + `position`). Si no, insert directo; duplicado → «Ya estás inscrito en este evento»; si el trigger `check_event_capacity` dispara a mitad del insert (carrera con otro registro concurrente) → **fallback a la waitlist** en lugar de error.
- `joinWaitlist`: rechaza con «El evento tiene plazas disponibles. Apúntate directamente» cuando aún hay huecos y no ha pasado el deadline (la waitlist solo admite eventos llenos/cerrados); duplicado → 23505 → «Ya estás en la lista de espera».
- `computeRegistrationStatus` (función pura en `queries.ts`, con inyección del reloj `now` para tests): deriva `isFull`, `isDeadlinePassed`, `registrationOpen` y el estado del viewer (`registered` / `waitlisted` / `none`); un inscrito siempre reporta `registered` aunque el evento esté lleno.

### 4. Onboarding obligatorio — `'ninguno'` como única representación canónica de «sin grupo»

- La columna `workgroup` ahora es `NOT NULL` con default `'ninguno'` (migración 0047): **la única representación canónica de "sin grupo"** es `'ninguno'` — un `NULL` derrotaría la comparación del middleware.
- El backfill es deliberadamente selectivo: solo filas `component_type = 'member'`; una fila `music`/`dance` sin grupo aborta la migración con un error accionable (debe asignarse antes de desplegar), porque `profiles_component_type_requires_workgroup` rechaza `'ninguno'` para ellas. El `ALTER ... SET NOT NULL` se ejecuta **después** del backfill y del fail-fast, de modo que el despliegue aborta limpio y nunca a medias.
- `requiresWorkgroupOnboarding(workgroup)` (`src/lib/supabase/auth-gate.ts`, helper puro): `true` para `null` (defensivo) o `'ninguno'`; cualquier otro valor = onboarding completado.
- **Middleware** (`src/lib/supabase/middleware.ts`): el gate de onboarding corre **después** del gate de status — un miembro `pending`/`suspended` ve `/auth/pending` primero y nunca queda atrapado en el onboarding; `/onboarding` está en `PUBLIC_ROUTES`, por lo que la página de onboarding no se redirige a sí misma. Un usuario sin sesión sigue yendo a `/auth/login`.
- `/onboarding/workgroup` (layout standalone, sin `AppShell`: el miembro aún no tiene acceso) redirige a `/dashboard` si ya tiene grupo real. `setMyWorkgroupSchema` excluye `'ninguno'` (elegir grupo real es obligatorio; desasignar es decisión del super admin → vive en `setMemberWorkgroupSchema`).

### 5. Permisos sobre el grupo de trabajo

- `updateMemberWorkgroup` pasa a ser **super_admin-only** (endurecimiento frente al patrón `requireAdmin` del resto de mutaciones admin): el grupo de trabajo gobierna el acceso a eventos por grupo y a los paneles de asistencia, por lo que es un cambio privilegiado. La UI de `/admin/users` oculta también el selector `MemberWorkgroupSelect` para cualquier rol que no sea `super_admin`. Se añade `requireSuperAdmin` a `src/lib/auth/permissions.ts`.
- `setMyWorkgroup` (propio usuario, onboarding o `/profile`) se restringe siempre a la fila del actor (`eq("id", actor.id)`), sin `'ninguno'` posible.
- **Deuda documentada:** `updateMemberProfile` (alcance admin, para campos personales) conserva el campo `workgroup` en su esquema, por lo que un `admin` podría técnicamente cambiar el grupo vía esa ruta. No se endurece en este sprint porque el mismo formulario no lo expone; endurecimiento futuro opcional: eliminar `workgroup` de `updateMemberProfileSchema`. La guarda canónica y la UI viven en `updateMemberWorkgroup`.

### 6. Privacidad de la cola

La RLS `event_waitlist_select_own_or_management` permite a cada miembro leer **solo su propia fila** (su posición) y a management la lista completa. **No existe conteo público** de «N en espera»: la medida «Lista de espera (N)» del panel solo se renderiza para management. Los `firstName`/`lastName` de otros miembros en la lista solo llegan a la UI de management.

### 7. `image_url` con `<img>` simple (sin `next/image`)

Se evita configurar `remotePatterns` de `next/image` (cambio global en `next.config.ts`, indeseable para una sola URL opcional). La imagen se renderiza con un `<img>` plano (con `eslint-disable-next-line @next/next/no-img-element`), validada en dos barreras independientes: Zod en el cliente (`/^https?:\/\/[^\s]+$/`) y el CHECK SQL `chk_events_image_url_http` (espejo exacto).

### 8. Usuarios de retorno — comportamiento esperado

Un super admin puede forzar `'ninguno'` a un miembro `member` vía `updateMemberWorkgroup` («desasignar»). Ese usuario **volverá a pasar por onboarding** en su siguiente navegación (el middleware lo redirige a `/onboarding/workgroup`). Es el comportamiento esperado y documentado: `'ninguno'` es la señal canónica de «sin grupo», y el gate la respeta en ambos sentidos.

### 9. UI y server actions

- **Server actions** (todas con `revalidatePath` tras éxito): `comments-actions.ts` (`addEventCommentAction`, `deleteEventCommentAction`), `waitlist-actions.ts` (`joinWaitlistAction`, `leaveWaitlistAction`, `setWaitlistEntryStatusAction`, `removeWaitlistEntryAction`), `registration-actions.ts` (devuelve `status`/`position`), `profile/actions.ts` (`setMyWorkgroupAction`).
- **`/events/[id]` rediseñada**: lugar (MapPin), imagen, deadline con badge «Inscripción cerrada» cuando ha pasado, aforo con barra de ocupación, y `RegistrationPanel` con **4 estados**: inscrito («Darme de baja»), en lista de espera («Abandonar lista de espera (posición #N)»), plazas libres («Apuntarme») y lleno/cerrado («Apuntarme a la lista de espera»). Panel management: lista de inscritos con `unregisterFromEvent({ userId })` y lista de espera con «Promover» / «Quitar».
- **`CommentsSection`**: lista nueva-primero con nombres de autor (patrón de `questions`), formulario y borrado (autor o management).
- **`event-form.tsx`** + `new/page.tsx`: campos `location`, `imageUrl`, `registrationDeadline`.
- **Calendario**: `calendar-widget.tsx` añade el enlace «Calendario» → `/calendar` junto al «Ver todos» → `/events`; `listEvents`/`getEventById` propagan los campos nuevos sin romper la vista mensual existente.
- **Onboarding**: `src/app/onboarding/workgroup/page.tsx` + `workgroup-selection-form.tsx`.
- **Perfil**: sección «Mi grupo de trabajo» (`workgroup-section.tsx`) con selector (sin `'ninguno'`) y nota de quién puede cambiarlo.
- **Admin**: selector de grupo solo visible para `super_admin`; `updateMemberWorkgroupAction` delega en la mutación endurecida.

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| Calcular `position` en la capa de aplicación (JS) | Dos joins concurrentes leerían el mismo `max(position)+1` y duplicarían posiciones; los triggers con lock de la fila del evento (`SELECT … FOR UPDATE`) serializan y son atómicos. |
| Posición con `count(*)` sin lock | Carrera de condiciones idéntica al caso anterior; el lock de fila del evento + `max(position)+1` es el patrón ya usado por `check_event_capacity`. |
| Promover desde la waitlist con el cliente anónimo del miembro que se da de baja | La RLS de `event_waitlist` (UPDATE management) bloquearía al miembro; la promoción debe ejecutarse con `service_role` en el servidor, con grants mínimos explícitos (nunca DELETE). |
| Representar «sin grupo» con `NULL` | Un `NULL` rompería la comparación `workgroup = 'ninguno'` del middleware; `NOT NULL` + default `'ninguno'` hace la representación única y robusta. |
| Backfill genérico `'ninguno'` para todas las filas con NULL | Violaría `profiles_component_type_requires_workgroup` (23514) en `music`/`dance` y abortaría la migración; el backfill solo para `member` + fail-fast con mensaje accionable es seguro y auto-documentado. |
| Gate de onboarding ANTES del de status en el middleware | Un miembro `pending`/`suspended` acabaría en el onboarding en lugar de `/auth/pending`; el orden status → onboarding es el único coherente. |
| Mantener `updateMemberWorkgroup` con `requireAdmin` | Un `admin` podría cambiar grupos (visibilidad de eventos por grupo y paneles); el grupo es un dato privilegiado → solo `super_admin`. |
| Mostrar «N en espera» públicamente | Filtraría información de la cola (quiénes esperan y cuántos); cada miembro solo ve su propia posición vía RLS. |
| `next/image` con `remotePatterns` para `image_url` | Requiere abrir `next.config.ts` de forma global para una URL opcional; `<img>` plano con validación Zod + CHECK SQL (http/https, sin espacios) cubre el caso sin superficie adicional. |
| Regenerar `database.types.ts` con el CLI de Supabase | El CLI no está instalado en el entorno (`supabase:gen-types` depende de él); la edición manual es precisa y reversible con `npm run supabase:gen-types`. |

---

## Consecuencias

### Positivas

- Eventos con lugar, imagen y deadline; página de detalle completa con 4 estados de registro y panel de gestión de inscritos + waitlist.
- Los comentarios siguen el patrón probado de `question_comments` (enriquecimiento de autores en dos queries, sin FK a `profiles`).
- Promoción automática tras cada baja (FIFO por `position`, tie-break `joined_at`); cola siempre gapless por trigger.
- Onboarding cierra el hueco de «sin grupo»: `'ninguno'` canónico, columna `NOT NULL`, backfill seguro y `create_emailless_profile` v3 normalizada.
- Middleware con orden correcto status → onboarding; `/onboarding` público.
- Suite completa: **544 tests en 38 archivos pasando** (`npx vitest run`), `tsc --noEmit` y `eslint . --max-warnings=0` limpios (verificados en local).

### Seguridad (defensa en profundidad)

- **Validación en servidor** de capacidad/deadline en `joinWaitlist`/`registerForEvent` (la RLS no puede expresar «el evento está lleno»); `check_event_capacity` queda como backstop atómico y su violación a mitad de insert cae a la waitlist.
- **Grants `service_role` mínimos**: `SELECT/INSERT/UPDATE` en `event_waitlist`, `SELECT/INSERT` en `event_registrations`; el cliente admin nunca borra (las bajas pasan por RLS como el miembro/management actuante).
- **Privacidad de la cola**: cada miembro ve solo su posición; management la lista completa; sin conteo público.
- **Grupo de trabajo privilegiado**: `updateMemberWorkgroup` solo `super_admin` (+ UI oculta para el resto); el propio usuario solo su propia fila y nunca `'ninguno'`.
- **Triggers `SECURITY DEFINER`** con `set search_path = umsuka, public` (patrón aceptado y documentado del proyecto, como `is_workgroup_lead`/`is_component_lead`): escritura limitada a `event_waitlist`/`events`, sin superficie nueva.
- Sin hallazgos HIGH en el escaneo del sprint (tarea con status `security-cleared`).

### Riesgos / pendientes

- **Tipos de BD mantenidos a mano** en `src/types/database.types.ts` (CLI de Supabase ausente en el entorno): regenerar con `npm run supabase:gen-types` cuando el CLI esté disponible; el diff actual es compatible uno-a-uno con las migraciones 0044–0046.
- **Deuda documentada**: `updateMemberProfile` (alcance admin) conserva `workgroup` en su esquema — endurecimiento futuro opcional (eliminar el campo del esquema).
- `profiles_component_type_requires_workgroup` sigue `NOT VALID` (deuda de la migración 0041): validar con `alter table … validate constraint` una vez saneadas las legacy rows (el backfill de 0047 las reduce).
- **Sin PR todavía**: cambios en el working tree de `feature/sprint-17-events-enhancement`, pendientes del pipeline estándar (commit siguiendo `docs/git-conventions.md`, PR con plantilla, escaneo de seguridad final).
- La promoción manual de una entrada (`setWaitlistEntryStatus` → `promoted`) se permite incluso tras el deadline (decisión deliberada: la gestión de la cola es de management).

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101004400_events_metadata.sql` | CREATE — columnas `registration_deadline`/`location`/`image_url` + CHECKs + índice |
| `supabase/migrations/20260101004500_event_comments.sql` | CREATE — tabla `event_comments` + RLS (select activo, insert propia, delete propia/management) |
| `supabase/migrations/20260101004600_event_waitlist.sql` | CREATE — enum `waitlist_status`, tabla `event_waitlist`, triggers de posición race-safe, RLS, grants `service_role` |
| `supabase/migrations/20260101004700_workgroup_onboarding_defaults.sql` | CREATE — backfill `'ninguno'` solo `member`, fail-fast music/dance, `NOT NULL` + default, `create_emailless_profile` v3 |
| `src/lib/events/schema.ts` | MODIFY — `location`/`imageUrl`/`registrationDeadline` + schemas de comentarios y waitlist |
| `src/lib/events/queries.ts` | MODIFY — campos nuevos en `listEvents`/`getEventById`, `getEventComments`, `getWaitlistForEvent`, `getMyWaitlistEntry`, `computeRegistrationStatus` (puro) |
| `src/lib/events/mutations.ts` | MODIFY — `addEventComment`/`deleteEventComment`, `joinWaitlist`/`leaveWaitlist`, `setWaitlistEntryStatus`, `removeWaitlistEntry`, `promoteNextFromWaitlist` |
| `src/lib/registrations/mutations.ts` | MODIFY — `registerForEvent` → waitlist si lleno/deadline (y fallback por carrera); `unregisterFromEvent` → promoción automática |
| `src/lib/profiles/schema.ts` | MODIFY — `setMyWorkgroupSchema` sin `'ninguno'` |
| `src/lib/profiles/mutations.ts` | MODIFY — `setMyWorkgroup`; `updateMemberWorkgroup` super_admin-only |
| `src/lib/auth/permissions.ts` | MODIFY — `requireSuperAdmin` |
| `src/lib/supabase/auth-gate.ts` | CREATE — `requiresWorkgroupOnboarding` (helper puro) |
| `src/lib/supabase/middleware.ts` | MODIFY — gate de onboarding tras el de status; `/onboarding` en `PUBLIC_ROUTES` |
| `src/types/database.types.ts` | MODIFY — manual: `events` + `event_comments` + `event_waitlist` + `WaitlistStatus` + `waitlist_status` |
| `src/app/events/[id]/comments-actions.ts` | CREATE — server actions de comentarios |
| `src/app/events/[id]/waitlist-actions.ts` | CREATE — server actions de waitlist |
| `src/app/events/[id]/registration-actions.ts` | MODIFY — `status`/`position` en el resultado |
| `src/app/events/[id]/page.tsx` | MODIFY — rediseño: lugar, imagen, deadline, estado de registro, comentarios |
| `src/app/events/[id]/registration-panel.tsx` | MODIFY — 4 estados + panel de gestión (inscritos, promover/quitar) |
| `src/app/events/[id]/comments-section.tsx` | CREATE — lista + formulario + borrado autor/management |
| `src/app/events/event-form.tsx`, `src/app/events/new/page.tsx` | MODIFY — campos `location`/`imageUrl`/`registrationDeadline` |
| `src/components/dashboard/calendar-widget.tsx` | MODIFY — enlace «Calendario» → `/calendar` |
| `src/app/onboarding/workgroup/page.tsx` | CREATE — página de onboarding (layout standalone) |
| `src/app/onboarding/workgroup/workgroup-selection-form.tsx` | CREATE — selector de grupo obligatorio |
| `src/app/profile/page.tsx` | MODIFY — sección «Mi grupo de trabajo» |
| `src/app/profile/workgroup-section.tsx` | CREATE — selector de grupo propio |
| `src/app/profile/actions.ts` | MODIFY — `setMyWorkgroupAction` |
| `src/app/admin/users/page.tsx` | MODIFY — selector de grupo solo para `super_admin` |
| `tasks/sprint-17-events-enhancement.json` | CREATE — tarea del sprint (status `security-cleared`) |
| `tasks/plan-desarrollo-completo.md` | MODIFY — sección Sprint 17 definida (la fila de la tabla de sprints queda pendiente de marcar ✅ cuando se cierre el sprint) |
| `docs/adr-sprint-17-events-enhancement.md` | CREATE — este ADR |

### Tests

| Archivo | Tests |
|---|---|
| `tests/unit/lib/events-schema.test.ts` (MODIFY) | 26 — campos nuevos (`location`/`imageUrl`/`registrationDeadline`) en los tres schemas |
| `tests/unit/lib/events-waitlist-schema.test.ts` (CREATE) | 16 — schemas de comentarios y waitlist (`join`/`leave`/`setStatus`/`remove`) |
| `tests/unit/lib/events-comments.test.ts` (CREATE) | 9 — add/delete con autor y management, rechazos |
| `tests/unit/lib/events-registration-flow.test.ts` (CREATE) | 15 — registro directo, waitlist por aforo/deadline, fallback por carrera, unregister + promoción |
| `tests/unit/lib/registration-status.test.ts` (CREATE) | 11 — `computeRegistrationStatus` (puro, reloj inyectado) |
| `tests/unit/lib/auth-gate.test.ts` (CREATE) | 4 — `requiresWorkgroupOnboarding` |
| `tests/unit/lib/profiles-workgroup.test.ts` (CREATE) | 8 — `setMyWorkgroup` y `updateMemberWorkgroup` super_admin-only (mocks) |
| `tests/unit/lib/profiles-schema.test.ts` (MODIFY) | 20 — `setMyWorkgroupSchema` sin `'ninguno'` |

**Total de la suite: 544 tests en 38 archivos, todos pasando** (`npx vitest run`). `npx tsc --noEmit` y `npx eslint . --max-warnings=0` limpios (salida verificada: exit 0).