# ADR-021: Sprint 21 — Administración: Panel de Control

**Status:** Accepted · **Date:** 2026-08-18

---

## Context

La app (comparsa con miembros, roles y management) tenía administración dispersa y sin registro
de actividad: `/admin/users` era un directorio con edición de rol, alta/baja y perfil (Sprint 19),
`/admin/registrations` gestionaba aprobaciones/suspensiones (Sprint 6), pero **no existía**
configuración global persistente, ni un historial de acciones administrativas, ni un modelo de
permisos granular más allá de los guards fijos `isAdminRole`/`isManagementRole`
(`src/lib/auth/roles.ts`). Ninguna acción administrativa quedaba registrada: un cambio de rol o
una suspensión eran invisibles para el resto del management.

Se requería (criterios de aceptación del task file):

- Los super admin (y admin) gestionan todos los usuarios desde `/admin/users` con tabla completa
  (nombre, email, rol, status, componente, fecha de registro); cambiar rol, activar/suspender,
  aprobar/suspender.
- Configuración global (nombre de la app, URL de Instagram) modificable desde `/admin/settings`
  y persistida en `umsuka.settings`.
- Cada acción administrativa queda registrada en `umsuka.audit_logs` (cambio de rol, alta/baja,
  aprobación/suspensión, cambios de settings).
- Los logs se consultan en `/admin/audit` con filtros por usuario, acción y fecha.
- Permisos granulares (`umsuka.role_permissions`) determinan qué rol ejecuta cada acción sin
  romper los guards existentes (`isAdminRole`/`isManagementRole`).
- Solo super_admin/admin acceden al panel: RLS, guards de página y server actions bloquean al
  resto.

### Estado previo

- `/admin/users` listaba sin columnas de email ni fecha de registro; las acciones de usuario
  (`updateMemberRoleAction`, `setMemberActiveAction`, `updateMemberComponentTypeAction`,
  `updateMemberWorkgroupAction`, `setComponentLeadAction`, creación de cuentas sin email, reset
  de contraseña, desbloqueo) vivían sueltas en `src/app/admin/users/actions.ts` cómo thin
  wrappers, **sin auditoría**.
- `/admin/registrations/actions.ts` aprobaba/suspendía directamente contra
  `src/lib/approvals/mutations.ts`, sin registro.
- No existían `umsuka.settings`, `umsuka.audit_logs` ni `umsuka.role_permissions`; la BD tampoco
  exponía los emails de `auth.users` por PostgREST (tabla fuera del schema `umsuka` y sin
  relación embebible con `profiles`).
- El patrón de **emisor best-effort en TypeScript** del Sprint 20 (`src/lib/notifications/emit.ts`)
  y la capa `lib/*` server-only con `requireAuthenticatedProfile` son los modelos de arquitectura
  que este sprint replica para la auditoría.
- `src/types/database.types.ts` se edita a mano (nunca se regenera con el CLI), patrón de todos
  los sprints; sin entorno Supabase local: el SQL es hand-reasoned y queda pendiente de
  verificación manual (checklist en la propia migración y en
  [Revisión SQL manual](#revisión-sql-manual-pendiente)).

---

## Decisión

### D1 — `settings.value` tipo `text` (no `jsonb`) con cap en aplicación

La tabla `umsuka.settings` es key/value con `value text NOT NULL` (migración 0053):

| Columna | Tipo | Restricción |
|---|---|---|
| `key` | `text` PK | CHECK `length(key) <= 100` |
| `value` | `text` NOT NULL | CHECK `length(value) <= 500` |
| `updated_by` | `uuid` nullable | FK `auth.users(id)` **ON DELETE SET NULL** (traza quién cambió el valor; null en filas seedeadas o si el autor se borra) |
| `updated_at` | `timestamptz` NOT NULL | `default now()` |

Semilla upsert-safe (`on conflict (key) do nothing`): `app_name = 'Umsuka Imbali'` e
`instagram_url = 'https://instagram.com/umsukaimbali'`.

El valor es **texto libre**, no JSON: las dos claves conocidas (y las futuras previsibles) son
escalares; `jsonb` habría añadido serialización/validación sin beneficiar ningún consumidor
actual. La capa de aplicación endurece el límite: `updateSettingSchema` (zod, `src/lib/admin/
schema.ts`) exige clave ∈ `SETTING_KEYS` (`app_name`/`instagram_url`, espejo del seed), trim y
tope de **300 caracteres** (más estricto que el CHECK de 500 de BD, comentado en la migración),
con refine que impide vaciar `app_name` ("El nombre de la app no puede estar vacío.") —
`instagram_url` sí puede limpiarse. `SETTING_KEY_LABELS` provee las etiquetas en español
("Nombre de la asociación", "URL de Instagram"). Las claves se restringen en la app (zod enum) y
la BD solo acota longitudes: un setting nuevo se añade al schema y al seed juntos.

### D2 — Auditoría en la capa TypeScript (no triggers SQL): `logAuditAction` central

El registro de auditoría vive en `logAuditAction(input: LogAuditInput)` (`src/lib/admin/
mutations.ts`), un único punto invocable desde cualquier servicio de servidor (patrón del emisor
de notificaciones del Sprint 20). Mismo razonamiento que ADR-020 D4 frente a la alternativa de
triggers/funciones SQL `SECURITY DEFINER`:

- La autorización ya está resuelta en TS (`requireAuthenticatedProfile` + `requirePermission`
  en cada mutación); recomponerla en SQL duplicaría lógica sin beneficio.
- Cada acción auditada ocurre **dentro** de una mutación TS existente; el trigger SQL exigiría
  instrumentar la BD (p. ej. tablas de staging o `NOTIFY`) para capturar contexto como
  `{fromRole, toRole}` que solo la capa de aplicación conoce.
- Sin entorno Supabase local, el SQL adicional no sería verificable; la capa TS es
  unit-testable (33 tests de `admin-mutations.test.ts` con cliente mockeado).

`logAuditActionSchema` valida la entrada (actorId uuid, `action` ∈ las 13 del CHECK, `entityType`
1–100 caracteres, `entityId` null o ≤ 200, `details` objeto JSON/null); `LogAuditInput =
z.input<typeof schema>` mantiene opcionales los campos para los callers y normaliza
`entityId`/`details` a `null` en el parse. El INSERT va por el **cliente autenticado**
(`createClient()`, nunca el cliente service_role): la política de RLS
`audit_logs_insert_admin` exige actor admin **y** `user_id = auth.uid()` — es imposible insertar
una fila "en nombre de otro" desde la BD misma (ver D5 y Seguridad).

### D3 — `logAuditAction` best-effort (nunca lanza)

Contrato idéntico al emisor de notificaciones (ADR-020 D4): entrada inválida, error de INSERT o
throw inesperado → `console.error` (mensaje + código) y **swallow**; el `catch` externo cubre
cualquier error imprevisto. Justificación: una falla del trail **nunca puede romper la mutación
de negocio** que la originó — el log es evidencia posterior, no parte del estado transaccional
de la acción. Consecuencia aceptada: una acción exitosa puede quedar sin fila de auditoría si la
BD falla en ese instante (consistencia eventual del log; el CHECK de acción y la RLS siguen
garantizando que toda fila que sí se escribe es válida y propia del actor).

### D4 — `audit_logs.user_id` FK `ON DELETE SET NULL` + nombres de actor resueltos en TS

`user_id uuid references auth.users(id) on delete set null`: las filas de auditoría **sobreviven**
a la futura eliminación de cuentas (Sprint 22, que borrará `auth.users`); con `CASCADE` (como en
notificaciones) el trail desaparecería con la cuenta. El costo es que el nombre de visualización
no se puede obtener por join: PostgREST **no puede embeber a través de `auth.users`** (tabla
fuera del schema expuesto por la API), así que la resolución es TS: `listAuditLogs` recolecta los
`user_id` distintos de la página, hace **una única query** `.in("id", actorIds)` sobre `profiles`
(`first_name`, `last_name`) y rellena `actorName`; cualquier id sin fila (cuenta borrada o
`user_id` null por el SET NULL) se muestra como **"Usuario eliminado"**. La query de perfiles es
best-effort: si falla, los nombres caen a "Usuario eliminado" sin romper la página.

### D5 — `audit_logs` append-only para TODOS (sin UPDATE/DELETE, ni super_admin)

La tabla tiene **exactamente dos políticas**: `audit_logs_select_admin` (SELECT `to
authenticated` con `umsuka.is_admin()`) y `audit_logs_insert_admin` (INSERT con
`umsuka.is_admin() AND user_id = auth.uid()`). **No existen políticas de UPDATE ni de DELETE —
ni para `super_admin`**: un log mutable no es un log; cualquier corrección del registro debe ser
otra fila de auditoría, no una edición. El contrato se refuerza en la capa de aplicación: la app
solo inserta (`logAuditAction`), nunca actualiza ni borra. El comentario de tabla y la sección
"SECURITY" de la migración lo documentan.

### D6 — RLS de `settings`: SELECT/INSERT/UPDATE para admin, DELETE solo super_admin

```
settings_select_admin    for select  to authenticated using (umsuka.is_admin())
settings_insert_admin    for insert  to authenticated with check (umsuka.is_admin())
settings_update_admin    for update  to authenticated using (umsuka.is_admin()) with check (...)
settings_delete_super_admin  for delete to authenticated using (umsuka.is_super_admin())
```

El **upsert** de la capa de aplicación bajo el capó ejecuta INSERT y, en re-saves, UPDATE — por
eso el UPDATE para admin es imprescindible (el upsert exige UPDATE) y no basta con
SELECT/INSERT. El **DELETE queda solo para super_admin**: el upsert de la app nunca borra filas,
pero un futuro camino de limpieza (retirar claves obsoletas) no debe estar al alcance de un
admin simple. Las 3 tablas nuevas activan RLS `enable` **y** `force`; los writes van por el
cliente autenticado, así que las políticas son a la vez el camino de escritura y el backstop.
`service_role` recibe **cero grants** sobre las tres tablas: nada de este sprint necesita
escrituras privilegiadas y el trail debe quedar admin-scoped.

### D7 — SELECT de `settings` restringido a `is_admin()` (nada de config pública por API)

Contraste con el patrón de `profiles` (Sprint 19, política SELECT para cualquier miembro activo):
los settings son **globales y no sensibles por sí mismos** (nombre de la app, URL de Instagram),
pero se restringen igualmente a admin por defecto. No se decide hoy qué claves serían públicas;
cuando un setting deba leerse sin sesión (p. ej. en la landing), se creará un RPC dedicado
`get_public_settings` con allowlist explícita **fuera de alcance de este sprint** (comentado en
la migración como nota de diseño). `role_permissions`, en cambio, sí es legible por **todo
miembro activo** (`role_permissions_select_active` con `umsuka.is_active_member()`): la matriz no
es secreta y la autorización real vive en la capa de aplicación (`hasPermission`), no en el
SELECT de la tabla.

### D8 — Permisos granulares: tabla como fuente de verdad + mapa en memoria isomórfico (sync testeada)

`umsuka.role_permissions (role, permission)` con PK compuesta, CHECKs de rol (6) y permiso (5),
y seed:

| Role | Permisos |
|---|---|
| `super_admin` | `users.read`, `users.manage`, `settings.read`, `settings.write`, `audit.read` |
| `admin` | idéntico a super_admin (los 5) |
| `board_member` | `users.read` |
| `event_manager` | `users.read` |
| `member` / `guest` | sin filas |

(Permiso `users.read` para board_member/event_manager = el set de `isManagementRole`.)

**Estrategia** (comentada en `src/lib/admin/permissions.ts`): el mapa en memoria
`PERMISSIONS_BY_ROLE` es la fuente para los guards (hot path — sin query por guard, sin
dependencia de la BD, isomórfico: también lo usan client components y `nav-links.ts`) y es
**fail-closed** (`permissionsForRole` devuelve `[]` para roles desconocidos, `hasPermission`
devuelve `false` para roles null/undefined, `requirePermission` lanza `AuthorizationError`). La
**tabla SQL conserva el role de fuente de verdad documental**: el test de sincronía
`PERMISSIONS_BY_ROLE ↔ SQL seed sync` (en `admin-permissions.test.ts`) lee el literal del seed de
la migración 0053 y compara ambos conjuntos (`role:permission`) — cualquier desviación rompe la
suite.

**Integración incremental sin tocar `src/lib/auth/roles.ts` ni `src/lib/auth/permissions.ts`**
(cero cambios en `git status`): `isAdminRole`/`isManagementRole`/`canAssignRole` siguen vivos
para lo que ya gobernaban (nav de `/admin/users`, `/admin/registrations`, asignación de
super_admin/admin dentro de `profiles.updateMemberRole`), mientras los módulos nuevos usan
`hasPermission`/`requirePermission`:

| Guard | Mecanismo |
|---|---|
| `/admin/users` (página) | `hasPermission(users.read)`; acciones si `hasPermission(users.manage)` |
| `/admin/users/[id]` (página) | `hasPermission(users.manage)` |
| `/admin/settings` (página) | `hasPermission(settings.read)` |
| `/admin/audit` (página) | `hasPermission(audit.read)` |
| Queries de `lib/admin/queries.ts` | `requirePermission(users.read / settings.read / audit.read)` |
| Mutaciones de `lib/admin/mutations.ts` | `requirePermission(settings.write / users.manage)` |
| `nav-links.ts` | `/admin/settings` y `/admin/audit` con `hasPermission`; `/admin/users` e `isManagementRole` y `/admin/registrations` con `isAdminRole` intactos |

`board_member`/`event_manager` ven el directorio en **solo lectura** (sin selects de edición, sin
botones de acción — `canManage` condiciona el render, páginas incluidas); un intento directo a
las mutaciones falla en `requirePermission`.

### D9 — Sin `listAuditLogsAction`: filtros de `/admin/audit` vía `searchParams`

No existe server action de listado; `/admin/audit` es un **server component** que parsea los
`searchParams` de la URL con `auditLogFiltersSchema` y renderiza la página resultante de
`listAuditLogs(filters)` (head-only count + ventana de datos en `Promise.all`, orden
`created_at desc`). Consecuencia: cada conjunto de filtros es una **URL compartible y
refrescarle** (`/admin/audit?user=<id>`, `?action=user.role_changed&from=2026-08-01&to=2026-08-18
&page=2`), la paginación son Links que preservan los filtros (`buildPageHref`) y no hay estado
client-side que sincronizar. `searchParams` inválidos (user no-uuid, acción desconocida, page no
entera) caen al fallback `{ offset: 0, page: 1 }` en la página — nunca se rompe. El **filtro por
usuario** lo alimenta la propia UI del directorio: cada fila de `/admin/users` y la cabecera de
`/admin/users/[id]` enlazan "Ver logs" → `/admin/audit?user=<id>`.

### D10 — `get_user_emails(uuid[])`: SECURITY DEFINER con re-check admin + enmascarado central

Los emails viven en `auth.users`, inaccesible por PostgREST; `listUsersOverview` los resuelve con
el RPC `umsuka.get_user_emails`:

```sql
create or replace function umsuka.get_user_emails(p_user_ids uuid[])
returns table (id uuid, email text)
language plpgsql stable security definer
set search_path = umsuka, public
as $$ begin
  if not umsuka.is_admin() then raise exception 'forbidden'; end if;
  return query
    select u.id,
           case when u.email like '%@umsuka.internal' then null else u.email end
    from auth.users u where u.id = any(p_user_ids);
end; $$;
```

- **SECURITY DEFINER** para poder leer `auth.users`, pero con **re-check** de `umsuka.is_admin()`
  dentro del cuerpo (fail-closed: cualquier otro rol recibe `forbidden`), `search_path` fijado a
  `umsuka, public` y llamadas schema-qualified (hardening contra hijacking de search_path).
- **Enmascarado en SQL, no en la app**: todo email `%@umsuka.internal` (cuentas sin email del
  Sprint 6) se devuelve como `null` — la regla de privacidad del proyecto queda **centralizada
  en la BD** y es imposible olvidarla en un consumidor futuro. La UI lo muestra como "—".
- **Grants mínimos + hardening**: `grant execute ... to authenticated` (solo el cliente
  autenticado; `service_role` no lo necesita) y `revoke execute ... from public` (PostgreSQL
  otorga EXECUTE a PUBLIC por defecto — revocación explícita como defensa en profundidad).
- **Fail-closed en la app**: si el RPC falla (`listUsersOverview` lo envuelve en try/catch con
  `console.error`), el directorio se renderiza igual con `email: null` en todas las filas —
  nunca crashea la vista de solo lectura de board_member/event_manager (que tienen `users.read`
  pero no `is_admin()` en BD).

### D11 — Filtro `to`: crudo `YYYY-MM-DD` en la URL, `toEndOfDay` derivado en el parse

`auditLogFiltersSchema` conserva `to` **en su forma cruda (YYYY-MM-DD)** en el estado de filtros
y en las URLs (paginación/round-trip de `buildPageHref`), y **deriva** en el `.transform` del
schema `toEndOfDay = new Date(`${to}T23:59:59.999Z`).toISOString()` que solo consume el query
layer en la cláusula `.lte("created_at", toEndOfDay)` — el valor derivado nunca llega a la URL.
Así el mismo valor crudo se puede re-inyectar en URLs y re-parsear sin drift (regresión M1
cubierta por test de round-trip). `from` se aplica crudo con `.gte` (inicio del día UTC).
**Limitación aceptada y documentada** (nota m7 en el schema): el fin de día se calcula en UTC,
por lo que en husos negativos el último día del rango pierde las horas entre 00:00 local y
00:00 UTC — el filtro es una conveniencia de día, no un límite exacto.

### D12 — `updated_at` explícito en el upsert de settings (PostgREST no lo toca en ON CONFLICT)

`updateSetting` construye el payload con `updated_at: new Date().toISOString()` y
`updated_by: actor.id` y upserta con `onConflict: "key"`. Justificación: el `ON CONFLICT DO
UPDATE` de PostgREST solo escribe las columnas presentes en el payload y **no re-evalúa los
defaults**, por lo que un re-save sin `updated_at` explícito dejaría el timestamp del primer
guardado (regresión M2) y la traza "última edición" (que alimenta la tarjeta de settings) sería
falsa. `updated_by` se fija siempre al actor resuelto server-side.

### Cobertura de auditoría — las 13 acciones, emitidas exactamente una vez

El CHECK `chk_audit_logs_action` fija el conjunto en BD; `AUDIT_ACTIONS` lo espeja en TS. Punto
único de emisión: las mutaciones de `lib/admin/mutations.ts` auditan sus propias acciones y las
server actions **nunca auditan por sí mismas** (delegan en los wrappers), mientras los flujos
legacy que aún no pasan por `lib/admin` auditan desde `src/app/admin/users/actions.ts` vía
`auditAsActor` (helper que resuelve el actor y llama a `logAuditAction`, con el mismo contrato
best-effort). Una denegación dentro de los módulos delegados (`canAssignRole` en
`profiles.updateMemberRole`, auto-baja, auto-suspensión) produce **cero filas** — no hay acción
que registrar.

| # | `action` | Emisor | `entity_type` | `entity_id` | `details` |
|---|---|---|---|---|---|
| 1 | `user.role_changed` | `mutations.updateUserRole` (pre-lectura del rol previo) | `profile` | `userId` | `{fromRole, toRole}` |
| 2 | `user.activated` | `mutations.setUserActive` | `profile` | `userId` | — |
| 3 | `user.deactivated` | `mutations.setUserActive` | `profile` | `userId` | — |
| 4 | `user.approved` | `mutations.approveUser` (tras `approvals.approveUser`, que además emite la notificación `profile_approved`) | `profile` | `userId` | — |
| 5 | `user.suspended` | `mutations.suspendUser` | `profile` | `userId` | — |
| 6 | `user.profile_updated` | `users/actions.ts` (`auditAsActor`) | `profile` | `userId` | — |
| 7 | `user.component_type_changed` | `users/actions.ts` | `profile` | `userId` | — |
| 8 | `user.workgroup_changed` | `users/actions.ts` | `profile` | `userId` | — |
| 9 | `user.component_lead_changed` | `users/actions.ts` `setComponentLeadAction` (super_admin) | `profile` | `userId` | `{component}` |
| 10 | `user.emailless_created` | `users/actions.ts` | `auth.user` | — | `{username}` |
| 11 | `user.password_reset_generated` | `users/actions.ts` | `profile` | `profileId` | — |
| 12 | `user.account_unlocked` | `users/actions.ts` | `profile` | `profileId` | — |
| 13 | `settings.updated` | `mutations.updateSetting` | `settings` | `key` | — |

Server actions nuevas (`src/app/admin/actions.ts`, `registrations/actions.ts`) y los delegadores
(`updateMemberRoleAction`, `setMemberActiveAction`) solo hacen `revalidatePath` en éxito — sin
fila extra, por diseño (comentado en cada archivo).

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| (a) `settings.value` como `jsonb` | Las claves (y las previsibles) son escalares; `jsonb` añadiría serialización/validación sin consumidor que lo beneficie; el CHECK de longitud y el cap de 300 en app cubren las necesidades (D1). |
| (b) Triggers/funciones SQL `SECURITY DEFINER` para registrar auditoría | La autorización ya está resuelta en TS, el contexto (`{fromRole, toRole}`) solo lo conoce la capa de aplicación, no hay entorno Supabase local para verificar SQL extra y el emisor TS es unit-testable — mismo razonamiento que ADR-020 D4 (D2). |
| (c) `logAuditAction` lanzando errores (fail-high) | Una falla del trail rompería mutaciones administrativas ya consolidadas; best-effort con `console.error` garantiza que el log nunca sea punto de fallo (D3). |
| (d) FK `ON DELETE CASCADE` (espejo de notifications) | El trail debe sobrevivir a la eliminación de cuentas del Sprint 22; `SET NULL` + "Usuario eliminado" en la UI preserva la evidencia (D4). |
| (e) UPDATE/DELETE de `audit_logs` para `super_admin` ("poder corregir el log") | Un log mutable no es un log: cualquier corrección debe ser una fila nueva; sin políticas de UPDATE/DELETE para rol alguno (D5). |
| (f) DELETE de `settings` para admin | El upsert de la app nunca borra; abrir el DELETE a un admin simple crearía un camino de limpieza innecesario; queda solo super_admin (D6). |
| (g) `settings` legibles por cualquier miembro activo (patrón profiles) | Expone configuración global por API sin necesidad; cuando una clave deba ser pública se hará un RPC `get_public_settings` con allowlist explícita, fuera de alcance (D7). |
| (h) Consultar `role_permissions` por query en cada guard | Latencia y acoplamiento a la BD en el hot path; el mapa en memoria isomórfico es fail-closed, testeable y la tabla+test de sync conservan la fuente de verdad (D8). |
| (i) `listAuditLogsAction` con estado client-side (fetch + setState) | Sin URLs compartibles, paginación/filtros propensos a desync, y estado duplicado server/client; `searchParams` + server component lo resuelven con URLs limpias (D9). |
| (j) Exponer emails con una vista SQL o join a `auth.users` | PostgREST no embebe a través de `auth.users`; el RPC `SECURITY DEFINER` con re-check admin, search_path fijado y enmascarado central resuelve el acceso sin grants amplios (D10). |
| (k) Convertir `to` a fecha-hora en la URL (`to=...T23:59:59Z`) | Rompe el round-trip (el valor derivado no se puede re-parsear como `YYYY-MM-DD` sin perder exactitud); crudo en URL + `toEndOfDay` derivado en el parse preserva las URLs (D11). |
| (l) Confiar en el `updated_at` automático del upsert | PostgREST `ON CONFLICT DO UPDATE` no re-evalúa defaults para columnas ausentes; sin el campo explícito, un re-save dejaría el timestamp del primer guardado (regresión M2, D12). |

---

## Edge cases manejados

| Escenario | Comportamiento |
|---|---|
| `board_member`/`event_manager` con `users.read` llamando al RPC de emails | `umsuka.is_admin()` falla en BD → `forbidden` → `listUsersOverview` captura y renderiza emails `null` ("—") con `console.error` (fail-closed, nunca crashea) |
| Filtros inválidos en `searchParams` de `/admin/audit` | Zod rechaza → fallback `{ offset: 0, page: 1 }`; la página se renderiza sin filtros |
| Round-trip de `to` entre filtros y paginación | `buildPageHref` re-inyecta el valor crudo `YYYY-MM-DD`; `toEndOfDay` derivado nunca llega a la URL (regresión M1 testeada) |
| Husos negativos en el filtro `to` | Las horas entre 00:00 local y 00:00 UTC del último día se pierden (límite UTC aceptado y documentado, m7) |
| Actor borrado / `user_id` null (SET NULL del Sprint 22) | `actorName = "Usuario eliminado"`; resolución de nombres con una sola query `.in()` sobre `profiles` |
| Query de nombres de actor fallida | Best-effort: todos los actores de la página caen a "Usuario eliminado" sin romper la tabla |
| Upsert re-save de un setting | `updated_at`/`updated_by` explícitos en el payload — nunca queda el timestamp del primer guardado (M2) |
| `app_name` vacío desde la UI o el cliente | Guard client-side en `SettingsForm` + refine zod en el schema; `instagram_url` sí puede limpiarse |
| `value` > 300 caracteres | Zod rechaza (300) antes de llegar al CHECK de BD (500) |
| Error en el RPC de emails (caída de BD, permisos) | `listUsersOverview` devuelve filas con email null; el directorio jamás falla por el email |
| Insertar una fila de auditoría "en nombre de otro" | Imposible: política `audit_logs_insert_admin` exige `user_id = auth.uid()`; la capa TS siempre usa el actor resuelto server-side |
| Denegación dentro de módulos delegados (`canAssignRole`, auto-baja, auto-suspensión) | Sin fila de auditoría: no hubo acción (no auditar intentos fallidos de la propia capa) |
| `logAuditAction` con entrada inválida o error de INSERT | `console.error` + swallow (best-effort): la mutación reporta su propio resultado, el trail puede quedar sin fila (aceptado) |
| Violación 23505 del responsable de componente | `setComponentLeadAction` la traduce a mensaje amigable en español ("Ya existe un responsable designado…"); comprobación de detalle del índice como fallback |
| Target inactivo/pendiente/no existente para responsable | Rechazo con mensaje en español y sin UPDATE; limpiar un cargo sí está siempre permitido |
| `updateUserRole` sin poder leer el rol previo (target inexistente) | Error de lectura → `{ success: false, error }` sin fila de auditoría |
| Página 0, negativa o no entera en `/admin/audit` | `z.coerce.number().int().min(1)` con default 1; `page 0` → se ignora y cae a 1 |
| Cuenta legacy sin fila en `settings` para una clave conocida | `getSetting` devuelve `null`; el form renderiza el campo vacío y el primer guardado hace el INSERT |

---

## Consecuencias

### Positivas

- Panel de control completo: directorio `/admin/users` con email (enmascarado), rol, status,
  componente, grupo, responsable, fecha de registro (columna `created_at` del perfil) y
  acciones (editar, rol, alta/baja, aprobar/suspender, reset/unlock, cuentas sin email, ver
  logs); `/admin/settings` con persistencia key/value; `/admin/audit` con filtros y paginación
  por URL.
- Trail de auditoría de **13 acciones con punto único de emisión**: las mutaciones de
  `lib/admin` auditan una sola vez y las server actions nunca duplican; los flujos legacy migran
  a `logAuditAction` vía `auditAsActor`.
- Permisos granulares integrados **sin tocar** `src/lib/auth/roles.ts` ni
  `src/lib/auth/permissions.ts`; `isAdminRole`/`isManagementRole` intactos para la navegación
  existente; tabla y mapa en memoria sincronizados por test.
- Escrituras por el cliente autenticado: las políticas RLS son el camino de escritura y el
  backstop final; sin grants `service_role` nuevos.
- Suite completa: **995 tests en 66 archivos pasando** (149 tests nuevos en 8 suites nuevas),
  `npx tsc --noEmit` y `npx eslint . --max-warnings=0` limpios, y security scan **CLEAN sin
  issues HIGH** (verificados en local).

### Seguridad (defensa en profundidad)

- **RLS forzada** en las 3 tablas nuevas, 7 políticas `to authenticated`; `audit_logs` sin
  UPDATE/DELETE para ningún rol; DELETE de `settings` solo super_admin; INSERT de auditoría
  siempre con `user_id = auth.uid()`.
- **Emails internos nunca expuestos**: enmascarado `@umsuka.internal → null` en SQL dentro del
  RPC (regla centralizada, no depende de ningún consumidor) + la UI solo muestra "—".
- **RPC hardened**: SECURITY DEFINER con re-check `umsuka.is_admin()` (fail-closed),
  `search_path` fijado, llamadas schema-qualified, grant solo `authenticated` y revoke de
  PUBLIC.
- **Autorización en aplicación**: páginas con `hasPermission` + redirect; queries y mutaciones
  con `requirePermission` (throw `AuthorizationError`); mapa fail-closed (roles null/desconocidos
  → `false`/`[]`).
- **Menor superficie**: PII de perfiles sin cambios (proyección contact-free de Sprint 19); el
  directorio admin añade solo el email vía RPC gateado.
- **Sin privilegios amplios**: `service_role` sin grants en las tablas nuevas; los writes
  administrativos pasan por RLS como cualquier usuario (con rol admin).

### Riesgos / pendientes

- **La migración 0053 debe aplicarse antes del deploy**: la app selecciona las tres tablas
  nuevas y el RPC en `queries.ts`, `mutations.ts` y `permissions.ts` (sync test inclusive); sin
  la migración, esas queries fallarían. Pendiente de la verificación manual (no hay entorno
  Supabase local).
- **Sprint 22** usará `logAuditAction` y los MÓDULOS admin (ver `tasks/plan-desarrollo-completo.
  md`): la eliminación de cuentas dejará el trail intacto (FK SET NULL) gracias a D4.
- **Filtro por usuario sin control propio en `/admin/audit`**: existe en schema+query y se
  alimenta desde los enlaces "Ver logs" (`?user=<id>`), pero el formulario de filtros no tiene
  un select de usuario aún (comentado en `audit-log-view.tsx`); criterio de aceptación cubierto
  por URL, pendiente de UI si el producto lo pide.
- **Cobertura del test del responsable de componente**: `setComponentLeadAction` ganó auditoría
  en este sprint pero `tests/unit/lib/admin-set-component-lead.test.ts` (pre-existente, sin
  cambios) no moquea `@/lib/admin/mutations` ni aserta la fila de auditoría — pasa porque el
  mock estricto lanza y `logAuditAction` lo traga (best-effort). Ver desviaciones para el SDD
  Master.
- `npm audit` pre-existente con hallazgos **INFO** (no introducidos por este sprint; no se
  endurecen aquí).
- `tasks/sprint-21-admin-panel.json` (gestionado por el orquestador) vive en el working tree; los
  cambios de código también (sin commitear aún) en la rama `feature/sprint-21-admin-panel`
  siguiendo `docs/git-conventions.md`; el PR y el escaneo security-champion los gestiona el
  pipeline estándar.

---

## Revisión SQL manual (pendiente)

No hay Docker/Supabase local disponible en el entorno de implementación; el SQL es hand-reasoned.
La migración 0053 incluye su propio checklist (sección final del archivo). Resumen de lo que hay
que verificar antes del deploy:

- [ ] `pg_policies` muestra **exactamente 7 políticas** nuevas (settings_select/insert/
      update_admin, settings_delete_super_admin, audit_logs_select/insert_admin,
      role_permissions_select_active), todas `to authenticated`.
- [ ] `relrowsecurity = true` **y** `relforcerowsecurity = true` en `umsuka.settings`,
      `umsuka.audit_logs` y `umsuka.role_permissions`.
- [ ] Seeds: 5 filas de permisos para super_admin y para admin, 1 (users.read) para
      board_member y event_manager, 0 para member/guest; settings `app_name` e `instagram_url`.
- [ ] Un admin puede SELECT/INSERT/UPDATE settings y SELECT/INSERT audit_logs (con
      `user_id = auth.uid()`); UPDATE/DELETE de audit_logs falla para TODOS (append-only, D5);
      DELETE de settings falla para un admin simple.
- [ ] Un miembro no-admin obtiene cero filas/zero inserts en las tres tablas; role_permissions
      sí es legible por todo miembro activo.
- [ ] `umsuka.get_user_emails` como admin devuelve emails con los aliases `@umsuka.internal`
      enmascarados a null; como no-admin lanza `forbidden`; EXECUTE revocado de PUBLIC y
      concedido solo a `authenticated`.
- [ ] CHECKs: key > 100, value > 500, action fuera de las 13, entity_type > 100, entity_id > 200,
      role/permission fuera de los conjuntos — todos rechazados.
- [ ] `supabase db push` aplica la migración (o `npm run supabase:reset` en local); una
      re-ejecución falla limpiamente en CHECKs/políticas duplicados (sin `IF NOT EXISTS`,
      comportamiento deseado).

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101005300_admin_panel.sql` | CREATE — `umsuka.settings` (value text, FKs SET NULL, CHECKs, seed), `umsuka.audit_logs` (CHECK de 13 acciones, 4 índices), `umsuka.role_permissions` (PK compuesta, CHECKs, seed de 12 filas), RLS enable+force con 7 políticas, `get_user_emails` (SECURITY DEFINER + masking + grant/revoke), comentarios de columna y checklist manual |
| `src/types/database.types.ts` | MODIFY — union `Permission` (5), tablas `settings`/`audit_logs`/`role_permissions` (Row/Insert/Update) y función `get_user_emails` (hand-authored, nunca regenerado) |
| `src/lib/admin/schema.ts` | CREATE — capa **isomórfica** (client-safe, sin imports server-only): `SETTING_KEYS`/labels, `AUDIT_ACTIONS` (13)/labels, `AUDIT_PAGE_SIZE` (50), `updateSettingSchema` (enum key, 300 chars, app_name no vacío), `logAuditActionSchema` + `LogAuditInput` (z.input), `auditLogFiltersSchema` (`to` crudo + `toEndOfDay` derivado + offset), mappers `mapSettingsRow`/`mapAuditLogRow` |
| `src/lib/admin/queries.ts` | CREATE — `listSettings`, `getSetting` (requirePermission settings.read), `listAuditLogs` (audit.read; count head-only + ventana en paralelo; filtros user/action/from/toEndOfDay; nombres vía `.in()` sobre profiles con fallback "Usuario eliminado"), `listUsersOverview` (users.read; `listProfiles` + RPC `get_user_emails` con fallback fail-closed a emails null) |
| `src/lib/admin/mutations.ts` | CREATE — `updateSetting` (settings.write; upsert onConflict "key" con `updated_by`/`updated_at` explícitos; audita `settings.updated`), `logAuditAction` (best-effort, nunca lanza), `updateUserRole` (pre-lectura `fromRole`; audita con `{fromRole, toRole}`), `setUserActive`, `approveUser`, `suspendUser` (todas users.manage; auditan una sola vez; denegaciones internas → sin fila) |
| `src/lib/admin/permissions.ts` | CREATE — `ALL_PERMISSIONS`, `PERMISSIONS_BY_ROLE` (espejo del seed), `permissionsForRole` (fail-closed `[]`), `hasPermission` (null-safe), `requirePermission` (throw `AuthorizationError`) |
| `src/app/admin/actions.ts` | CREATE — `updateSettingAction`, `approveUserActionAdmin`, `suspendUserActionAdmin`: thin wrappers que delegan en lib (auditoría ya dentro), `revalidatePath` en éxito, nunca auditan por sí mismas |
| `src/app/admin/settings/page.tsx` | CREATE — guard `settings.read` (+redirect), `listSettings`, `SettingsForm` |
| `src/app/admin/settings/settings-form.tsx` | CREATE — cliente: un Input por clave conocida, guard client-side de `app_name` no vacío, `Promise.all` de `updateSettingAction` por clave con resultado all-or-nothing visual (escrituras parciales documentadas) |
| `src/app/admin/audit/page.tsx` | CREATE — guard `audit.read`, parseo de `searchParams` con `auditLogFiltersSchema` (fallback seguro), `listAuditLogs` |
| `src/app/admin/audit/audit-log-view.tsx` | CREATE — cliente: GET form (acción/desde/hasta), paginación por Links que preservan filtros (`buildPageHref`), badge por acción en español, fecha con hora (es-ES), estado vacío; filtro `user` soportado por URL (sin campo propio aún) |
| `src/app/admin/users/page.tsx` | MODIFY — tabla completa (nombre, email enmascarado "—", componente, grupo, rol, responsable, estado, fecha de registro, alta/baja, acciones); vista solo-lectura para `users.read` sin manage; enlaces "Ver logs"; bloques super_admin (workgroup select, componente lead, cuentas sin email, unlock) |
| `src/app/admin/users/[id]/page.tsx` | MODIFY — guard `users.manage` (+redirect a /admin/users), enlaces "Ver logs" del miembro; formulario ampliado de Sprint 19 intacto |
| `src/app/admin/users/actions.ts` | MODIFY — `auditAsActor` (best-effort); auditoría en `updateMemberProfileAction`, `updateMemberComponentTypeAction`, `updateMemberWorkgroupAction`, `createEmaillessAccountAction` (details `{username}`), `generateResetTokenAction`, `unlockAccountAction` y `setComponentLeadAction` (details `{component}`); `updateMemberRoleAction`/`setMemberActiveAction` delegan en wrappers auditados (sin duplicados) |
| `src/app/admin/users/user-status-actions.tsx` | CREATE — botones Aprobar/Suspender (solo pending/active, nunca sobre sí mismo), `useTransition` + `router.refresh()`, errores en español |
| `src/app/admin/registrations/actions.ts` | MODIFY — `approveUserAction`/`suspendUserAction` delegan en los wrappers de lib (auditoría única, revalidan `/admin/registrations` + `/admin/users`) |
| `src/components/layout/nav-links.ts` | MODIFY — `NAV_LINKS` gana `/admin/settings` (hasPermission settings.read) y `/admin/audit` (hasPermission audit.read); `/admin/users` (isManagementRole) y `/admin/registrations` (isAdminRole) intactos |
| `src/lib/auth/roles.ts`, `src/lib/auth/permissions.ts`, `src/lib/profiles/mutations.ts`, `src/lib/approvals/mutations.ts`, `src/lib/notifications/emit.ts` | (sin cambios) — integración incremental de D8; wrappers de lib reutilizan los resolvers existentes |
| `tests/unit/lib/admin-schema.test.ts` | CREATE — 32 tests |
| `tests/unit/lib/admin-mutations.test.ts` | CREATE — 33 tests |
| `tests/unit/lib/admin-queries.test.ts` | CREATE — 21 tests |
| `tests/unit/lib/admin-permissions.test.ts` | CREATE — 19 tests |
| `tests/unit/lib/admin-actions.test.ts` | CREATE — 22 tests |
| `tests/unit/components/admin-settings-form.test.tsx` | CREATE — 6 tests |
| `tests/unit/components/admin-audit-log-view.test.tsx` | CREATE — 9 tests |
| `tests/unit/components/admin-user-status-actions.test.tsx` | CREATE — 7 tests |
| `docs/adr-sprint-21-admin-panel.md` | CREATE — este ADR |

### Tests

| Archivo | Tests |
|---|---|
| `tests/unit/lib/admin-schema.test.ts` (CREATE) | 32 — constantes (13 acciones, labels, claves de settings), `updateSettingSchema` (enum de clave, trim, 300 chars, app_name no vacío, instagram vaciable), `logAuditActionSchema` (uuid, whitelist, límites 100/200, normalización entityId/details → null), `auditLogFiltersSchema` (uuid/date/page, `to` crudo preservado, `toEndOfDay` derivado, offset), mappers |
| `tests/unit/lib/admin-mutations.test.ts` (CREATE) | 33 — updateSetting (permiso, upsert con `updated_by`/`updated_at` explícitos, auditoría única, errores), logAuditAction (entrada inválida → console.error sin lanzar, error de insert → swallow, throw inesperado → swallow), updateUserRole (fromRole/toRole en details, sin fila si el rol previo no se puede leer o el delegate deniega), setUserActive, approveUser/suspendUser wrappers | 
| `tests/unit/lib/admin-queries.test.ts` (CREATE) | 21 — listSettings/getSetting (permiso, orden, mapeo, errores), listAuditLogs (filtros user/action/from/toEndOfDay, ventana y count en paralelo, paginación, nombres de actor con `.in()`, fallback "Usuario eliminado", query de perfiles fallida), listUsersOverview (emails vía RPC, fallback fail-closed ante error del RPC) |
| `tests/unit/lib/admin-permissions.test.ts` (CREATE) | 19 — matriz completa por rol, `permissionsForRole` fail-closed (rol desconocido → `[]`), `hasPermission` (null/undefined → false), `requirePermission` (throw AuthorizationError) y **sync con el seed SQL**: lee el literal de la migración 0053 y compara ambos conjuntos `role:permission` |
| `tests/unit/lib/admin-actions.test.ts` (CREATE) | 22 — acciones del panel (updateSettingAction/approveUserActionAdmin/suspendUserActionAdmin delegan y revalidan), wiring de auditoría de users/actions.ts (cada flujo legacy audita exactamente una vez, sin duplicados en los delegadores), wiring de registrations/actions.ts |
| `tests/unit/components/admin-settings-form.test.tsx` (CREATE) | 6 — submit por clave vía server action, éxito/error visible, guard client-side de app_name vacío, limpieza del mensaje "guardado" al editar, loading |
| `tests/unit/components/admin-audit-log-view.test.tsx` (CREATE) | 9 — render de filas (fecha con hora, badge por acción, actor, entidad), vacío, paginación anterior/siguiente, formulario GET, y **round-trip de `buildPageHref`** (regresión M1): los filtros se preservan intactos entre páginas |
| `tests/unit/components/admin-user-status-actions.test.tsx` (CREATE) | 7 — Aprobar (solo pending) y Suspender (pending/active), disableSelf, errores mostrados, transición, refresco tras éxito |
| `tests/unit/lib/admin-set-component-lead.test.ts` (sin cambios) | 10 — suite pre-existente del Sprint 19; sigue pasando porque el nuevo `logAuditAction` absorbe el error del mock estricto (ver desviaciones) |

**Total de la suite: 995 tests en 66 archivos, todos pasando** (`npx vitest run`; 149 tests y 8
archivos más que al cierre del Sprint 20: 846 → 995, 58 → 66). `npx tsc --noEmit` y
`npx eslint . --max-warnings=0` limpios en local, y security scan **CLEAN sin issues HIGH**
(estado `security-cleared` del task file).