# ADR-020: Sprint 20 — Notificaciones (In-App + Realtime)

**Status:** Accepted · **Date:** 2026-08-18

---

## Context

La app (comparsa con miembros, roles y management) carecía de un canal interno de avisos: la
actividad de los módulos existentes — crear un evento (Sprint 3/17/18), publicar una noticia
(Sprint 10), abrir una votación (Sprint 15), asignar un turno (Sprint 8/12) y aprobar el alta de
un usuario (Sprint 6) — quedaba invisible para los miembros hasta que revisaban cada módulo por
separado. Se requería (criterios de aceptación del task file):

- Las notificaciones se crean automáticamente al asignar turnos, crear eventos, noticias y
  votaciones, y al aprobar usuarios.
- Contador de no leídas en el header (campana) con dropdown de las últimas, "marcar todas como
  leídas" y página `/notifications` con historial completo.
- Actualización en tiempo real (Supabase Realtime): contador y lista al día en vivo.
- Un usuario solo ve y modifica sus propias notificaciones (RLS + autorización en servidor).
- Preferencias por tipo: el usuario controla qué tipos de notificaciones recibe.

### Estado previo

- No existía ninguna tabla de notificaciones ni uso de Supabase Realtime en el repo.
- El widget "Notificaciones" del dashboard (Sprint 1) era **mock** (`generateMockNotifications`
  con state local y "marcar todas leídas" client-side); su JSDoc prometía reemplazo con datos
  reales.
- `src/types/database.types.ts` se edita a mano (nunca se regenera con el CLI), patrón de todos
  los sprints.
- No hay entorno Supabase local ni CLI disponible en el entorno de implementación: el SQL es
  hand-reasoned y queda **pendiente de verificación manual** (checklist en
  [Revisión SQL manual](#revisión-sql-manual-pendiente)).

---

## Decisión

### D1 — Esquema: `umsuka.notifications` + `umsuka.notification_preferences` (semántica `'{}'`)

`umsuka.notifications` (`supabase/migrations/20260101005200_notifications.sql`):

| Columna | Tipo | Restricción |
|---|---|---|
| `id` | `uuid` PK | `default gen_random_uuid()` |
| `user_id` | `uuid` NOT NULL | FK `auth.users(id)` **ON DELETE CASCADE** |
| `title` | `text` NOT NULL | CHECK `length(title) <= 200` |
| `message` | `text` nullable | CHECK `message is null or length(message) <= 1000` (contexto corto opcional: título del evento, descripción del turno…) |
| `type` | `text` NOT NULL | CHECK: `event_created` / `news_created` / `voting_created` / `shift_assigned` / `profile_approved` |
| `is_read` | `boolean` NOT NULL | `default false` |
| `link` | `text` nullable | CHECK `link is null or length(link) <= 2048` (destino in-app, p. ej. `/events/<id>`; null sin página objetivo) |
| `created_at` | `timestamptz` NOT NULL | `default now()` |

Índices:

```sql
create index if not exists idx_notifications_user_created
  on umsuka.notifications (user_id, created_at desc);   -- historial por usuario

create index if not exists idx_notifications_user_unread
  on umsuka.notifications (user_id)
  where is_read = false;                                -- parcial: badge de no leídas
```

`umsuka.notification_preferences`:

| Columna | Tipo | Restricción |
|---|---|---|
| `user_id` | `uuid` PK | FK `auth.users(id)` ON DELETE CASCADE |
| `types` | `text[]` NOT NULL | `default '{}'` |

**Semántica documentada** (en `comment on column` y en el contrato del emisor): `types = '{}'`
significa **recibir TODOS los tipos** (default); una **fila ausente** (cuenta legacy creada antes
de la migración 0052) se trata igual: recibir todos; un **array no vacío** es una whitelist: solo
se reciben los tipos listados (opt-out de todo lo no listado). No existe un estado "recibir nada"
(la app lo previene en la UI, ver D7).

Los 4 CHECK constraints se crean **sin `IF NOT EXISTS`** (patrón de la migración 0044): una
re-ejecución falla limpiamente en lugar de re-aplicar silenciosamente. Las tablas sí usan
`create table if not exists` (idempotencia de estructura).

### D2 — RLS: `enable` + `force` y 8 políticas own-row; grants `service_role` mínimos

Ambas tablas activan `enable row level security` **y** `force row level security`. Ocho políticas
`to authenticated` basadas en `auth.uid()` (4 por tabla, "own-row": solo el dueño de la fila la
lee/escribe/borra):

- `notifications_select_own` / `notifications_insert_own` (`with check (user_id = auth.uid())`)
  / `notifications_update_own` (`using` + `with check`) / `notifications_delete_own`.
- Espejo exacto en `notification_preferences` (`preferences_select_own`, `preferences_insert_own`,
  `preferences_update_own`, `preferences_delete_own`).

El rol `authenticated` ya tiene CRUD completo sobre ambas tablas por los **default privileges**
otorgados en la migración 0000; la RLS lo restringe a sus propias filas.

Grants a `service_role` — **solo lo que el emisor necesita** (inserta "en nombre de" otros
usuarios con el cliente privilegiado, que bypasea RLS):

```sql
grant select, insert on umsuka.notifications to service_role;
grant select, insert, update on umsuka.notification_preferences to service_role;
```

**Deliberadamente NO se otorga UPDATE de `notifications` a `service_role`** (least privilege): el
marcado como leído pasa siempre por el camino RLS del usuario autenticado; `service_role` solo lee
e inserta.

### D3 — Trigger: ampliación aditiva de `handle_new_user()` (preferencias por defecto)

`umsuka.handle_new_user()` (disparado por el trigger existente `on_auth_user_created`, migración
0012, sin cambios) se reemplaza con `create or replace function` **aditiva**: el cuerpo original
(creación de `profiles` con `on conflict (id) do nothing`) se conserva intacto y se añade:

```sql
insert into umsuka.notification_preferences (user_id)
values (new.id)
on conflict (user_id) do nothing;
```

Toda cuenta nueva recibe su fila de preferencias con `types '{}'`; el trigger no cambia. El
`comment on function` se actualiza para documentar la doble provision (profile + preferencias).

### D4 — Emisor central en TypeScript (no triggers/funciones SQL): `src/lib/notifications/emit.ts`

La creación de notificaciones vive en una capa TS de servidor — con `import "server-only"` y el
cliente privilegiado `createAdminClient()` (service_role, bypasea RLS a propósito: inserta filas
"en nombre de" otros usuarios; la cadena `server-only` garantiza fallo de build si se arrastra a
un Client Component). Contrato **best-effort**: todos los errores se registran con
`console.error` (mensaje + código) y **nunca se re-lanzan** — una falla de notificación no puede
romper la mutación de negocio que la originó; los call sites de los módulos añaden además su
propio `try/catch` (doble protección).

`notifyUsers({ userIds, type, title, message, link })`:

1. **Dedupe** de destinatarios (`new Set`); sin ids → return inmediato.
2. **Filtro por preferencias**: una única query
   `.in("user_id", uniqueIds)` sobre `notification_preferences` → `Map<user_id, types>`; fila
   ausente o `types.length === 0` → recibe todo; array no vacío → solo si incluye `type`.
3. **INSERT bulk de un solo statement** con todos los destinatarios restantes (sin N+1; si no
   queda ningún destinatario tras el filtro, no se toca la BD).

Resolución de destinatarios desde la BD (nunca de input del cliente):

- `getAllActiveMemberIds()` — `profiles` con `status = 'active'`, `select id`; `[]` en fallo.
- `resolveEventRecipients({ audience_type, audience_workgroup, audience_member_type,
  audience_user_ids })` — las **4 audiencias del Sprint 18**: `'all'` → miembros activos;
  `'workgroup'` → perfiles del grupo (validado con el type guard `isWorkgroup`, que también
  rechaza `'ninguno'`); `'member_type'` → perfiles del componente (type guard `isComponentType`);
  `'specific_users'` → los ids listados, deduped; valor desconocido → **fail closed** `[]`.

**Justificación vs. la alternativa de triggers/funciones SQL `SECURITY DEFINER`** (ver
alternativa (a)): la autorización ya está resuelta en TS por `requireAuthenticatedProfile` /
`requireManagement` en cada mutación; la resolución de audiencia del Sprint 18 no es trivial en
SQL; y sin entorno Supabase local el SQL no sería verificable. El emisor TS es unit-testable
(22 tests con cliente mockeado).

### D5 — Autorización y server actions

- `markAsRead(notificationId)` — `requireAuthenticatedProfile()` + **doble scope**
  `.update({ is_read: true }).eq("id", notificationId).eq("user_id", actor.id)`: un id ajeno
  actualiza 0 filas y reporta éxito (la UI refresca al estado real; nunca toca filas de otro).
- `markAllAsRead()` — `.eq("user_id", actor.id).eq("is_read", false)`.
- `updateNotificationPreferences(types)` — `updateNotificationPreferencesSchema` (enum de los 5
  tipos, dedupe con `Set`, tope `NOTIFICATION_TYPES.length`) + upsert
  `.upsert(..., { onConflict: "user_id" })`.
- `createNotification(input)` — `createNotificationSchema` + INSERT por el cliente admin;
  **solo invocable desde código de servidor de confianza**, siempre con ids resueltos en la BD
  (nunca de input de cliente).

Server actions (`src/app/notifications/actions.ts`) — thin wrappers que reenvían al resolver y
hacen `revalidatePath("/notifications")` en éxito: `markNotificationReadAction`,
`markAllNotificationsReadAction` y `updateNotificationPreferencesAction`. `loadMoreNotificationsAction`
valida el offset con `loadMoreOffsetSchema` (zod: entero `0..5000` — un cliente manipulado no
puede escanear la tabla) y resuelve el `userId` **server-side** con `getCurrentProfile()`, nunca
del input.

### D6 — Realtime: publicación + canal por usuario (solo `notifications`, no preferencias)

```sql
alter publication supabase_realtime add table umsuka.notifications;
```

- **Solo `notifications`** entra en la publicación; `notification_preferences` no (config propia
  del usuario, sin actualizaciones concurrentes que justifiquen el stream).
- El worker de Realtime evalúa RLS **como el rol del JWT del suscriptor** (`authenticated`): las
  políticas own-row + los default privileges de la migración 0000 cubren el SELECT que el worker
  realiza, por lo que **no se requiere grant a `supabase_realtime_admin`** (la migración documenta
  el fallback `grant select on umsuka.notifications to supabase_realtime_admin;` para stacks
  legacy).
- **Replica identity por defecto (PK)**, sin `REPLICA IDENTITY FULL`: suficiente para eventos de
  fila completos.
- **Caveat documentado en la migración**: las políticas RLS no aplican a los eventos DELETE de
  Realtime; el filtro del canal (`user_id=eq.<userId>`) + la replica identity PK-only minimizan
  el leak residual a UUIDs de las propias filas.

Cliente (`src/lib/notifications/hooks.ts`, `useNotificationsRealtime`): canal por usuario
`notifications:<userId>` con filtro `user_id=eq.<userId>`, `event: "*"`, `schema: "umsuka"`,
`table: "notifications"`; cada evento **invalida la caché de TanStack Query** (claves de contador
y recientes). Si el canal se cierra (`CLOSED`/`CHANNEL_ERROR`) solo se registra un `console.warn`:
la UI sigue al día con las refetch normales (fallback silencioso). Ref guard contra doble
suscripción y `removeChannel` en unmount. El suscriptor se monta **una sola vez por AppShell**
(`NotificationsRealtime`), de modo que campana, widget y nav comparten un único canal.

### D7 — UI: campana, badge, página `/notifications`, preferencias y widget real

- **`NotificationBell`** (sidebar desktop, cabecera): badge de no leídas (tope "99+") + dropdown
  con las **5 últimas** (título, mensaje, tiempo relativo, icono/color por tipo); clic en un item →
  marcar leída (si no lo está) + `router.push(link ?? "/notifications")`; pie con "Marcar todo
  como leído" (deshabilitado con 0 no leídas) y "Ver todas". Se cierra con clic fuera y al
  navegar.
- **`NavNotificationBadge`**: micro-badge sobre el item "Notificaciones" de la navegación
  (sidebar **y** bottom-nav móvil); renderiza nada con 0 no leídas. `nav-links.ts` gana
  `{ href: "/notifications", label: "Notificaciones", icon: Bell }`.
- **Página `/notifications`** (server-rendered): `getCurrentProfile()` + redirect a login; la
  primera página (`NOTIFICATIONS_PAGE_SIZE = 50`) y las preferencias se cargan en `Promise.all`.
  `NotificationsList` (cliente) agrupa en **No leídas / Leídas** y pagina incrementalmente con
  "Cargar más" (`useTransition` + `loadMoreNotificationsAction(offsetActual)`, `hasMore` según
  fill de página). El marcado es **optimista** (revert al estado previo en `onError`) y la página
  **deliberadamente NO se refresca** (`router.refresh()` descartaría el estado local acumulado de
  páginas cargadas).
- **`NotificationPreferencesCard`**: master toggle "Recibir todas las notificaciones" (guarda
  `[]`, la opción por defecto) + checkboxes por tipo (deshabilitados con master on). Con master
  off, **el último tipo no se puede desmarcar** (`toggleType` con `prev.length <= 1 → return
  prev`): no existe un estado "recibir nada". Guarda vía server action + `router.refresh()`.
- **Widget del dashboard**: el mock de Sprint 1 se reemplaza por datos reales
  (`useRecentNotifications(userId, 5)` + badge + "Marcar todas leídas" con la server action);
  layout espejo del widget anterior. Iconos/colores por tipo centralizados en
  `notification-type-icon.tsx` (`event_created` Calendar/azul, `news_created` Megaphone/morado,
  `voting_created` Vote/índigo, `shift_assigned` Users/verde, `profile_approved`
  UserCheck/ámbar; desconocido → campana, defensivo).
- `formatRelativeTime` (isomórfico, mensajes en español): "ahora" (<60 s), "hace X min" (<1 h),
  "hace X h" (mismo día), "ayer", `DD/MM/YYYY` (más viejo); comparaciones de día en UTC para
  determinismo; `""` para input no parseable.

### D8 — Integraciones (todas best-effort, tras la mutación, con `try/catch` adicional)

| Mutación | Destinatarios | Título / mensaje / link |
|---|---|---|
| `createEvent` (`src/lib/events/mutations.ts`) | `resolveEventRecipients` con la **audiencia del Sprint 18** (all/workgroup/member_type/specific_users) | `Nuevo evento: <title>` / descripción truncada a 200 / `/events/<id>` |
| `createNews` (`src/lib/news/mutations.ts`) | `getAllActiveMemberIds` — **solo si `published = true`** (los drafts son silenciosos) | `Nueva noticia: <title>` / — / `/news/<id>` |
| `createVoting` (`src/lib/votings/mutations.ts`) | `getAllActiveMemberIds` | `Nueva votación: <title>` / — / `/votings/<id>` |
| `assignMemberToShift` (`src/lib/shifts/assignments.ts`) | el miembro asignado (`[parsed.data.userId]`) | `Turno asignado: <shift.name>` / título del evento (query `maybeSingle`) / `/events/<event_id>` si existe |
| `approveUser` (`src/lib/approvals/mutations.ts`) | el usuario aprobado | `¡Tu cuenta ha sido aprobada!` / `Ya puedes acceder a la app.` / `/dashboard` |

Los rollback best-effort existentes (evento con audiencia fallida, votación sin opciones) quedan
intactos: la notificación se emite **después** de que la mutación ya es consistente.

### D9 — TanStack Query: primer uso real en el repo

El `QueryProvider` existente (staleTime `30 s`, `retry: 1`, `refetchOnWindowFocus: false`) se usa
por primera vez de forma significativa: `src/lib/notifications/hooks.ts` define
**keys centralizadas** (`UNREAD_KEY = ["notifications", "unreadCount"]`,
`RECENT_KEY = ["notifications", "recent"]`, con `userId`/`limit` como sufijos) y los hooks
`useUnreadCount` (head-only count, fallback a 0 sin throw), `useRecentNotifications(userId, 5)`,
`useMarkAsRead` / `useMarkAllAsRead` (mutations que invocan las server actions e invalidan ambas
claves en `onSuccess`) y `useNotificationsRealtime`. **La actualización en vivo proviene del canal
Realtime (invalidación de caché), no de `refetchInterval`**; el `staleTime` solo controla si una
refetch reutiliza la caché.

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| (a) Triggers/funciones SQL `SECURITY DEFINER` para emitir notificaciones | La autorización ya está resuelta en TS (`require*Profile`/`requireManagement` en cada mutación), la resolución de audiencia del Sprint 18 no es trivial en SQL y no hay entorno Supabase local para verificar SQL adicional; el emisor TS es unit-testable (D4). |
| (b) SQL `NOTIFY`/trigger por módulo para la fan-out | Duplicaría en SQL la lógica de audiencia del Sprint 18 y las preferencias; el emisor central TS concentra ambas en un solo lugar testeable. |
| (c) Un INSERT por destinatario (loop) | N+1 innecesario; `notifyUsers` emite un solo INSERT bulk (D4). |
| (d) Grant UPDATE de `notifications` a `service_role` | Violaría least privilege: el marcar leído debe pasar por la RLS del propio usuario (D2); `service_role` solo lee e inserta. |
| (e) Refetch periódico (`refetchInterval`) en lugar de Realtime | Latencia y carga innecesarias; el canal Realtime entrega los cambios y solo invalida la caché (D6/D9). |
| (f) Canal Realtime global (sin filtro por usuario) | El cliente recibiría eventos de todos los usuarios (leak por diseño); el canal por usuario con filtro `user_id=eq.<userId>` + políticas own-row del worker (D6) cierra el acceso. |
| (g) Realtime también en `notification_preferences` | Config propia del usuario, sin actualizaciones concurrentes que justifiquen el stream; publicar solo `notifications` reduce superficie (D6). |
| (h) `router.refresh()` tras marcar leídas en `/notifications` | Descarta el estado local acumulado de paginación; el marcado optimista local mantiene las páginas cargadas (D7). |
| (i) Preferencias como filas por tipo (tabla opt-out) | Un `text[]` con semántica `'{}'`/whitelist cubre el requisito con menos superficie y una sola fila por usuario (D1). |
| (j) Una suscripción Realtime por consumidor (campana, widget, lista) | Múltiples canales redundantes; un único suscriptor montado en el AppShell sirve a todos (D6). |
| (k) Habilitar un estado "recibir nada" en preferencias | Sin valor para el producto y con riesgo de silencio permanente; la UI impide desmarcar el último tipo (D7). |

---

## Edge cases manejados

| Escenario | Comportamiento |
|---|---|
| Cuenta legacy sin fila en `notification_preferences` | "Recibir todos" (D1/D4): nunca queda excluida silenciosamente |
| `types = '{}'` vs array no vacío | `'{}'`/ausente → recibe todo; lista → whitelist (opt-out de lo no listado) |
| Fallo del emisor (query, insert o throw inesperado) | `console.error` + swallow (best-effort): la mutación de negocio nunca falla por una notificación; try/catch adicional en los call sites |
| Destinatarios duplicados (p. ej. audiencia con ids repetidos) | Dedupe con `Set` antes de consultar preferencias e insertar |
| `workgroup`/`component_type` nulos, `'ninguno'` o valores desconocidos | Type guards fail-closed: `[]` (nadie notificado) |
| Offset de paginación negativo, no entero o > 5000 | Zod rechaza antes de tocar la BD; offset = 5000 permitido |
| Canal Realtime cerrado / error de canal | `console.warn` y refetch normal: la UI nunca crashea (fallback silencioso) |
| Contador > 99 | Badge "99+" |
| `markAsRead` con id de otra persona (input manipulado) | Doble scope `.eq("id").eq("user_id")`: 0 filas, reporta éxito; la UI refresca al estado real |
| Noticia creada como draft (`published = false`) | Silenciosa: ninguna notificación emitida |
| Evento con audiencia `specific_users` | Destinatarios = ids listados (deduped), después de persistir las filas de audiencia |
| Turno sin evento asociado | `message`/`link` ausentes (null) — la notificación sigue siendo válida |
| Evento sin descripción para el mensaje | `message: undefined` (null en BD) |
| Fecha no parseable en `formatRelativeTime` | `""` (defensivo; la BD siempre emite timestamptz válido) |
| Eventos DELETE de Realtime (las policies no aplican) | Filtro `user_id=eq.<userId>` del canal + replica identity PK-only minimizan el leak a UUIDs propios (caveat documentado en la migración) |
| Preferencias: último tipo seleccionado con master off | No se puede desmarcar — no existe "recibir nada" (D7) |
| Lista `/notifications` con más de 50 ítems | Paginación incremental "Cargar más" con estado local acumulado; topes de offset |

---

## Consecuencias

### Positivas

- Canal interno de avisos completo: eventos, noticias, votaciones, turnos y aprobaciones generan
  notificaciones automáticas respetando audiencias y preferencias.
- Contador de no leídas en campana, nav (desktop + móvil) y widget del dashboard con datos
  reales (el mock de Sprint 1 desaparece).
- Historial completo en `/notifications` con agrupación, paginación incremental y marcado
  optimista.
- Actualización en vivo vía Supabase Realtime con invalidación de caché de TanStack Query
  (primer uso real del provider existente).
- Defensa en profundidad: CHECKs en BD + Zod en app, RLS own-row forced como backstop,
  autorización de servidor de doble scope, offset validado y fail-closed en la resolución de
  destinatarios.
- Suite completa: **846 tests en 58 archivos pasando** (98 nuevos en 8 suites nuevas de
  notificaciones + widget reescrito con 10 tests), `tsc --noEmit`, `eslint . --max-warnings=0`,
  `npm run build` y security scan **PASS sin issues HIGH** (verificados en local).

### Seguridad (defensa en profundidad)

- **RLS**: `force` en ambas tablas + 8 políticas own-row; un usuario solo lee/escribe/borra sus
  propias filas (la autenticada por los default privileges de la migración 0000).
- **Grants mínimos**: `service_role` solo SELECT/INSERT en `notifications` y
  SELECT/INSERT/UPDATE en `preferences`; sin UPDATE de notificaciones (el marcado pasa por RLS).
- **Emisor**: `server-only` + `createAdminClient` (service_role) restringido a código de servidor
  de confianza; destinatarios siempre resueltos desde la BD (nunca de input de cliente); fail
  closed ante valores corruptos de audiencia.
- **Server actions**: doble scope (`eq id + eq user_id`), `loadMoreNotificationsAction` con
  userId server-side y offset zodgeado (0..5000).
- **Realtime**: el worker evalúa RLS con el rol del JWT; canal por usuario con filtro
  `user_id=eq`; sin grants extras (fallback documentado).

### Riesgos / pendientes

- **La migración 0052 debe aplicarse antes del deploy**: la app selecciona las tablas nuevas en
  `queries.ts`, `mutations.ts`, `hooks.ts` y `page.tsx`; sin la migración, esas queries fallarían.
  Pendiente de la verificación manual (no hay entorno Supabase local).
- **Verificación SQL manual pendiente**: mismo patrón que Sprints 18/19 — el SQL es
  hand-reasoned. Ver [checklist](#revisión-sql-manual-pendiente).
- **La lista completa de `/notifications` es server-rendered y no se auto-actualiza con
  Realtime**: el canal invalida la caché del contador/recientes (campana, widget, nav); la página
  de historial se pone al día con `router.refresh()` tras las acciones (marcar leídas, guardar
  preferencias) o al re-navegar. Comportamiento asumido y documentado en `NotificationsList`.
- **Paginación con tope**: 50 ítems por página y offset máximo 5000 (≈250 páginas); un historial
  mayor queda fuera del alcance actual (los 5 tipos de notificación generan pocos ítems por día).
- `npm audit` pre-existente con hallazgos **INFO** (no introducidos por este sprint; no se
  endurecen aquí).
- `tasks/sprint-20-notifications.json` y `tasks/plan-desarrollo-completo.md` no se tocan en los
  commits (los gestiona el orquestador). Los cambios viven en el working tree (sin commitear
  aún); seguirán `docs/git-conventions.md` (rama `feature/sprint-20-notifications`, commits
  semánticos `feat(sprint-20): …`); el PR y el escaneo security-champion los gestiona el pipeline
  estándar.

---

## Revisión SQL manual (pendiente)

No hay Docker/Supabase local disponible en el entorno de implementación; el SQL es hand-reasoned.
Checklist para la verificación manual antes del deploy:

- [ ] `pg_policies` muestra exactamente 8 políticas nuevas (4 por tabla, todas `to
      authenticated`, own-row con `auth.uid()`).
- [ ] `pg_class.relrowsecurity = true` **y** `relforcerowsecurity = true` para
      `umsuka.notifications` y `umsuka.notification_preferences`.
- [ ] `pg_publication_tables` incluye `umsuka.notifications` (publicación `supabase_realtime`);
      `notification_preferences` NO está publicada.
- [ ] Un usuario autenticado puede insertar su propia fila en `notifications` y actualizarla/
      borrarla; insertar con `user_id` de otro usuario falla (política `with check`).
- [ ] `handle_new_user()`: un INSERT en `auth.users` produce AMBAS filas (profiles +
      notification_preferences con `types '{}'`); re-ejecución con `on conflict do nothing` sin
      error.
- [ ] Borrar un `auth.users` cascada: las filas de notifications y preferences desaparecen.
- [ ] `service_role` puede SELECT/INSERT en `notifications` y SELECT/INSERT/UPDATE en
      `notification_preferences`; UPDATE de `notifications` a `service_role` NO está concedido.
- [ ] Los 4 CHECK constraints rechazan: title > 200, message > 1000, link > 2048, type fuera de
      los 5 valores.
- [ ] `supabase db push` aplica la migración 0052 sin errores (o `npm run supabase:reset` en
      local); una re-ejecución falla limpiamente en los CHECKs duplicados y en la membresía
      duplicada de la publicación (comportamiento deseado).

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101005200_notifications.sql` | CREATE — tablas `notifications` + `notification_preferences`, CHECKs, índices (compuesto + parcial), grants `service_role` mínimos, RLS `enable`+`force` con 8 políticas own-row, ampliación aditiva de `handle_new_user()`, publicación Realtime, comentarios de columna y checklist manual |
| `src/types/database.types.ts` | MODIFY — `NotificationType` (union de 5 tipos) y tablas `notifications` / `notification_preferences` en Row/Insert/Update (hand-authored, nunca regenerado) |
| `src/lib/notifications/schema.ts` | CREATE — capa **isomórfica** (client-safe, sin imports server-only): `NOTIFICATION_TYPES`, `NOTIFICATION_TYPE_LABELS` (español), `NOTIFICATIONS_PAGE_SIZE` (50), `createNotificationSchema`, `updateNotificationPreferencesSchema` (dedupe, tope 5), mappers `mapNotificationRow`/`mapPreferenceRow`, `formatRelativeTime` |
| `src/lib/notifications/queries.ts` | CREATE — `getMyNotifications` (limit/offset, scoped por `user_id`), `getUnreadCount` (head-only, fallback 0), `getMyNotificationPreferences` (fila ausente → `{ types: [] }`) |
| `src/lib/notifications/mutations.ts` | CREATE — `markAsRead`/`markAllAsRead` (`requireAuthenticatedProfile` + doble scope), `updateNotificationPreferences` (upsert `onConflict: "user_id"`), `createNotification` (cliente admin, schema zod) |
| `src/lib/notifications/emit.ts` | CREATE — emisor central (`server-only`): `notifyUsers` (dedupe + filtro preferencias + INSERT bulk), `getAllActiveMemberIds`, `resolveEventRecipients` (4 audiencias Sprint 18, fail-closed) |
| `src/lib/notifications/hooks.ts` | CREATE — TanStack Query: `UNREAD_KEY`/`RECENT_KEY`, `useUnreadCount`, `useRecentNotifications`, `useMarkAsRead`/`useMarkAllAsRead`, `useNotificationsRealtime` (canal por usuario, invalidación, fallback silencioso) |
| `src/app/notifications/page.tsx` | CREATE — página server-rendered: redirect si no hay sesión, primera página (50) + preferencias en `Promise.all` |
| `src/app/notifications/actions.ts` | CREATE — `markNotificationReadAction`, `markAllNotificationsReadAction`, `updateNotificationPreferencesAction` (revalidatePath) y `loadMoreNotificationsAction` (offset zod 0..5000, userId server-side) |
| `src/app/notifications/notifications-list.tsx` | CREATE — historial con agrupación No leídas/Leídas, "Cargar más" con estado local acumulado, marcado optimista con revert |
| `src/app/notifications/notification-preferences-card.tsx` | CREATE — master toggle "Recibir todas" (guarda `[]`) + checkboxes por tipo (el último no se desmarca) |
| `src/components/layout/notification-bell.tsx` | CREATE — campana del sidebar: badge (99+), dropdown 5 últimas, marcar todo, "Ver todas", cierre por click fuera/navegación |
| `src/components/layout/nav-notification-badge.tsx` | CREATE — micro-badge sobre el item nav (sidebar y bottom-nav) |
| `src/components/layout/notifications-realtime.tsx` | CREATE — monta `useNotificationsRealtime` una vez por AppShell (renderiza null) |
| `src/components/notifications/notification-type-icon.tsx` | CREATE — iconos/colores por tipo (Calendar/Megaphone/Vote/Users/UserCheck; fallback campana) |
| `src/components/layout/app-shell.tsx` | MODIFY — monta `NotificationsRealtime` y pasa `userId` a Sidebar/BottomNav |
| `src/components/layout/sidebar.tsx` | MODIFY — `NotificationBell` en la cabecera + `NavNotificationBadge` sobre el item "Notificaciones" |
| `src/components/layout/bottom-nav.tsx` | MODIFY — `NavNotificationBadge` sobre el item móvil |
| `src/components/layout/nav-links.ts` | MODIFY — `NAV_LINKS` gana `{ href: "/notifications", label: "Notificaciones", icon: Bell }` |
| `src/components/dashboard/notifications-widget.tsx` | MODIFY — reemplaza el mock de Sprint 1 por datos reales (hooks + server action); iconos/colores por tipo |
| `src/app/dashboard/dashboard-content.tsx` | MODIFY — pasa `userId={profile.id}` a `NotificationsWidget` |
| `src/lib/events/mutations.ts` | MODIFY — `createEvent` emite `event_created` a la audiencia resuelta del Sprint 18 (best-effort) |
| `src/lib/news/mutations.ts` | MODIFY — `createNews` emite `news_created` solo si `published = true` |
| `src/lib/votings/mutations.ts` | MODIFY — `createVoting` emite `voting_created` a todos los activos (tras insertar opciones) |
| `src/lib/shifts/assignments.ts` | MODIFY — `assignMemberToShift` emite `shift_assigned` al miembro (title del turno, message/link del evento) |
| `src/lib/approvals/mutations.ts` | MODIFY — `approveUser` emite `profile_approved` al aprobado |
| `tests/unit/lib/notifications-schema.test.ts` | CREATE — 25 tests de schemas/constantes/mappers/tiempo relativo |
| `tests/unit/lib/notifications-queries.test.ts` | CREATE — 11 tests de queries (paginación, count head-only, preferencias) |
| `tests/unit/lib/notifications-mutations.test.ts` | CREATE — 12 tests de mutaciones (doble scope, upsert, cliente admin) |
| `tests/unit/lib/notifications-emit.test.ts` | CREATE — 22 tests del emisor (dedupe, preferencias, bulk insert, best-effort, resolución de audiencias, fail-closed) |
| `tests/unit/lib/notifications-actions.test.ts` | CREATE — 6 tests de server actions (flag de acciones, offset zod, userId server-side) |
| `tests/unit/lib/notifications-hooks.test.tsx` | CREATE — 7 tests de hooks (count, canal Realtime, invalidación, unmount, fallback) |
| `tests/unit/lib/notifications-integrations.test.ts` | CREATE — 9 tests de integración de los 5 módulos con el emisor (mocks scripted) |
| `tests/unit/components/notifications-list.test.tsx` | CREATE — 6 tests de la lista (agrupación, cargar más, marcado optimista, vacío) |
| `tests/unit/components/dashboard/notifications-widget.test.tsx` | MODIFY — reescrito para datos reales: 10 tests (badge, marcar todas, tope 5, vacío, userId en hooks; neto +3 sobre los 7 previos) |
| `tests/unit/lib/approvals/mutations.test.ts` | MODIFY — mock de `@/lib/notifications/emit` |
| `tests/unit/lib/events-audience-mutations.test.ts` | MODIFY — mock de `@/lib/notifications/emit` |
| `tests/unit/lib/votings-mutations.test.ts` | MODIFY — mock de `@/lib/notifications/emit` |
| `docs/adr-sprint-20-notifications.md` | CREATE — este ADR |

### Tests

| Archivo | Tests |
|---|---|
| `tests/unit/lib/notifications-schema.test.ts` (CREATE) | 25 — tipos canónicos y etiquetas, `createNotificationSchema` (uuid, trims, vacíos→null, límites 200/1000/2048, tipo), `updateNotificationPreferencesSchema` (vacío='{}', subconjuntos, dedupe, tope, rechazos), mappers, `formatRelativeTime` (ahora/min/h/ayer/fecha/`''`) |
| `tests/unit/lib/notifications-queries.test.ts` (CREATE) | 11 — ventana de paginación y defaults, mapeo camelCase, error contextual, count head-only con fallback 0, preferencias ausentes → `{ types: [] }` |
| `tests/unit/lib/notifications-mutations.test.ts` (CREATE) | 12 — doble scope own-row, error rebotado, actor ausente, upsert on-conflict, dedupe, rechazo sin tocar BD, insert admin + id devuelto |
| `tests/unit/lib/notifications-emit.test.ts` (CREATE) | 22 — dedupe, query de preferencias única, semántica '{}'/ausente/whitelist, bulk insert, sin destinatarios, errores logeados sin re-lanzar, `getAllActiveMemberIds`, `resolveEventRecipients` (all/workgroup/member_type/specific_users + fail-closed) |
| `tests/unit/lib/notifications-actions.test.ts` (CREATE) | 6 — página siguiente con userId server-side, offset negativo/no entero/>5000 rechazado, 5000 permitido, sin sesión |
| `tests/unit/lib/notifications-hooks.test.tsx` (CREATE) | 7 — count head-only scoped, fallback 0, canal por usuario con filtro `user_id=eq`, invalidación al recibir evento, removeChannel en unmount, warn sin crash, invalidación tras la server action |
| `tests/unit/lib/notifications-integrations.test.ts` (CREATE) | 9 — createEvent por audiencia (all/workgroup/specific_users), createNews publicado/draft, createVoting, assignMemberToShift, approveUser, y éxito de la mutación aunque el emisor falle |
| `tests/unit/components/notifications-list.test.tsx` (CREATE) | 6 — agrupación, "Cargar más" (append + ocultar botón en página corta/completa), marcado optimista individual y total, estado vacío |
| `tests/unit/components/dashboard/notifications-widget.test.tsx` (MODIFY) | 10 — título, badge (visible/oculto), botón marcar todas (visible/oculto/acción), títulos, tope 5, vacío, userId propagado a los hooks |

**Total de la suite: 846 tests en 58 archivos, todos pasando** (`npx vitest run`; 101 tests y 8
archivos más que al cierre del Sprint 19: 98 de las 8 suites nuevas + 3 netos del widget).
`npx tsc --noEmit`, `npx eslint . --max-warnings=0`, `npm run build` y security scan **PASS sin
issues HIGH**, todos limpiados en local tras el sprint.