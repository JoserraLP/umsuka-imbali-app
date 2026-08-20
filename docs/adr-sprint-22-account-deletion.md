# ADR-022: Sprint 22 — Eliminación Permanente de Cuentas (Solo Super Admin)

**Status:** Accepted (Implementado) · **Date:** 2026-08-19 · **Sprint:** 22 ·
**Branch:** `feature/sprint-22-account-deletion`

---

## Context

La app (comparsa con miembros, roles y management) no ofrecía forma de **eliminar** una cuenta:
las únicas salidas administrativas eran la baja (`is_active = false`, Sprint 19) y la suspensión
(`status = suspended`, Sprint 6), ambas reversibles y con el usuario de `auth.users` intacto. La
normativa de privacidad del proyecto (y el criterio del producto) exigen una eliminación
**permanente y real**: borrar el usuario de auth, su perfil y todos sus datos asociados, sin
dejar remanentes operativos.

Se requería (criterios de aceptación del task file):

- Solo el super admin puede eliminar cuentas permanentemente.
- La eliminación borra el usuario de auth, el perfil y todos sus datos asociados.
- Confirmación explícita de doble paso antes de eliminar.
- La eliminación queda registrada en el log de auditoría.
- Un super admin no puede eliminarse a sí mismo (protección).
- El sistema avisa de las consecuencias irreversibles antes de confirmar.

### Estado previo

- `auth.users` es el ancla de identidad: `profiles.id` es PK con FK `ON DELETE CASCADE` a
  `auth.users(id)` (migración 0001) y el trigger `handle_new_user()` (0012) provisiona la fila
  de perfil al alta. Ningún flujo previo borraba filas de `auth.users`.
- La mayoría de las FKs del schema `umsuka` a `auth.users` y `umsuka.profiles` se crearon con la
  acción por defecto (**NO ACTION**): `supabase.auth.admin.deleteUser()` fallaría con violación
  de FK en cuanto existiera cualquier fila hija.
- El Sprint 21 dejó deliberadamente preparado el terreno: `audit_logs.user_id` y
  `settings.updated_by` con `ON DELETE SET NULL` (ADR-021 D4) para que el trail de auditoría
  **sobreviva** a la eliminación de cuentas de este sprint.
- `src/types/database.types.ts` se edita a mano (nunca se regenera con el CLI), patrón de todos
  los sprints; sin entorno Supabase local: el SQL es hand-reasoned y queda pendiente de
  verificación manual (checklist en la propia migración y en
  [Revisión SQL manual](#revisión-sql-manual-pendiente)).

### El flujo implementado

`deleteAccountPermanently(userId)` (`src/lib/auth/delete-account.ts`) ejecuta los pasos en este
orden, con errores tipados por paso (`DeleteAccountResult { success, error? }`):

1. **Validar** el `userId` (uuid).
2. **Autorizar**: `requireAuthenticatedProfile()` y `actor.role === "super_admin"` (rol leído de
   la BD, no del JWT).
3. **Anti-self**: `userId === actor.id` → rechazo.
4. **Leer el target** (`profiles` vía cliente service_role, `maybeSingle`) — la existencia de la
   cuenta se decide aquí, con una sola fuente de verdad.
5. **Soft-delete** del perfil (`deleted_at = now()`): la cuenta desaparece al instante de todo
   path de lectura (RLS + queries de aplicación, migración 0054).
6. **Purge** de `password_reset_tokens` creados por el target (FK `created_by` NO ACTION que
   bloquearía el borrado físico).
7. **Borrado físico** con `admin.auth.admin.deleteUser()`: la fila de `profiles` cae por el
   CASCADE de 0001 y el resto de FKs cascada o pone null.
8. **Auditar** `user.deleted` una sola vez (best-effort, `logAuditAction` nunca lanza).

La server action `deleteAccountPermanentlyAction` (`src/app/admin/users/actions.ts`) valida la
confirmación escrita (refine zod: `ELIMINAR` tras trim + mayúsculas), delega en el servicio y
revalida `/admin/users` y `/admin/registrations` solo en éxito. La UI
(`src/app/admin/users/delete-account-button.tsx`) abre un `AlertDialog` de advertencia
("Esta acción no se puede deshacer") que exige teclear la palabra **ELIMINAR** antes de habilitar
el botón destructivo.

---

## Auditoría de datos asociados (inventario real, tabla por tabla)

Inventario verificado contra el DDL de las migraciones (nombres de constraint en el formato
por defecto `<tabla>_<columna>_fkey`). Se distinguen **cuatro grupos**: FKs que ya cascadan,
FKs que ya ponen null, FKs NO ACTION que este sprint migra a SET NULL, y el caso especial de
`password_reset_tokens.created_by`.

### Grupo A — FKs a `auth.users` con CASCADE ya existente (se conservan intactas)

| Tabla | Columna | Migración | Acción | Consecuencia |
|---|---|---|---|---|
| `profiles` | `id` (PK) | 0001 | CASCADE | El perfil desaparece con el usuario de auth; dispara a su vez los CASCADE del Grupo D |
| `shift_assignments` | `user_id` | 0004 | CASCADE | Los turnos asignados del miembro desaparecen |
| `attendance` | `user_id` | 0005 | CASCADE | Asistencias/faltas desaparecen |
| `absences` | `user_id` | 0006 | CASCADE | Ausencias solicitadas desaparecen |
| `voting_votes` | `user_id` | 0011 | CASCADE | Votos emitidos desaparecen (el recuento de la votación se recalcula solo) |
| `event_registrations` | `user_id` | 0015 | CASCADE | Inscripciones a eventos desaparecen (el evento conserva sus demás asistentes) |
| `workgroup_attendance` | `user_id` | 0018 | CASCADE | Asistencia de grupo de trabajo desaparece |
| `event_comments` | `user_id` | 0045 | CASCADE | Comentarios del miembro en eventos desaparecen |
| `event_waitlist` | `user_id` | 0046 | CASCADE | Posiciones en lista de espera desaparecen |
| `event_audience_users` | `user_id` | 0050 | CASCADE | Segmentación de audiencia se limpia |
| `notifications` | `user_id` | 0052 | CASCADE | Notificaciones del miembro desaparecen |
| `notification_preferences` | `user_id` | 0052 | CASCADE | Preferencias desaparecen |

**Decisión:** conservar CASCADE. Son datos **propios del usuario** (participación, preferencias,
notificaciones) sin valor de archivo para la comunidad una vez la persona deja de existir en el
sistema. Eliminarlos con la cuenta es precisamente el objetivo de una eliminación permanente, y
evita filas huérfanas que puedan filtrar PII residual.

### Grupo B — FKs a `auth.users` con SET NULL ya existente (se conservan intactas)

| Tabla | Columna | Migración | Acción | Consecuencia |
|---|---|---|---|---|
| `shift_assignment_groups` | `created_by` | 0040 | SET NULL | El grupo de turnos sobrevive; el autor queda null |
| `settings` | `updated_by` | 0053 | SET NULL | La traza "última edición" sobrevive; la UI muestra "—" si el editor fue borrado |
| `audit_logs` | `user_id` | 0053 | SET NULL | El trail de auditoría sobrevive (ADR-021 D4) |

**Decisión:** conservar SET NULL. El histórico tiene valor archivístico: los grupos de turnos
creados, la traza de settings y sobre todo el **trail de auditoría** deben sobrevivir a la
cuenta. El costo (autor null) ya está resuelto en la capa de aplicación: `listAuditLogs` muestra
"Usuario eliminado" para actores sin fila de perfil (ADR-021 D4) y la UI de settings degrada a
"—".

### Grupo C — FKs NO ACTION migradas a SET NULL en la migración 0054

| Tabla | Columna | Referencia | Migración de origen | Antes | Tras 0054 |
|---|---|---|---|---|---|
| `events` | `created_by` | `auth.users(id)` | 0002 | NO ACTION, nullable | SET NULL |
| `news` | `created_by` | `auth.users(id)` | 0007 | NO ACTION, nullable | SET NULL |
| `questions` | `user_id` | `auth.users(id)` | 0008 | NO ACTION | SET NULL |
| `question_comments` | `user_id` | `auth.users(id)` | 0039 | NO ACTION, **NOT NULL** | SET NULL + `drop not null` |
| `workgroup_attendance` | `marked_by` | `auth.users(id)` | 0018 | NO ACTION, nullable | SET NULL |
| `email_aliases` | `created_by` | `umsuka.profiles(id)` | 0028 | NO ACTION, nullable | SET NULL |

Nota de precisión (corrige el inventario preliminar del plan): `email_aliases.created_by`
referencia **`umsuka.profiles(id)`**, no `auth.users(id)`; como `profiles` se borra por el
CASCADE de 0001 al eliminar el usuario de auth, el efecto es idéntico: el alias sobrevive como
registro de auditoría con autor null.

**Decisión (D2, detalle en Decisiones):** el **contenido creado por el usuario se conserva y se
anonimiza** (autor → null); nunca se borra en cascada. Justificación por grupo: (a) sin la
conversión, el `deleteUser` físico fallaría con violación de FK (motivo funcional inmediato);
(b) CASCADE destruiría contenido comunitario ajeno a la cuenta (un evento tiene otros asistentes,
publicar cancela el registro de una votación en curso); (c) estas tablas no almacenan PII del
autor — solo su id — por lo que nullar el autor es anonimización suficiente; no hace falta
reescribir el contenido. Los queries que resuelven nombres de autor ya contemplan el null
(p. ej. `question_comments.userId` nullable en `src/lib/questions/queries.ts`, con fallback de
mostrado "Miembro").

### Grupo D — FKs a `profiles` con CASCADE (se conservan intactas)

| Tabla | Columna | Migración | Acción | Consecuencia |
|---|---|---|---|---|
| `email_aliases` | `profile_id` | 0028 | CASCADE | Los alias de email de la cuenta desaparecen |
| `password_attempts` | `profile_id` | 0034 | CASCADE | El historial de intentos fallidos desaparece |
| `password_reset_tokens` | `profile_id` | 0035 | CASCADE | Los tokens de la cuenta desaparecen |

**Decisión:** conservar CASCADE. Son datos internos del ciclo de vida de la cuenta (credenciales
de acceso, intentos y alias) sin valor tras la eliminación. Su borrado hay que garantizarlo, no
preservarlo.

### Caso especial — `password_reset_tokens.created_by` (purge manual en el servicio)

| Tabla | Columna | Referencia | Migración | Estado |
|---|---|---|---|---|
| `password_reset_tokens` | `created_by` | `umsuka.profiles(id)` | 0035 | **NOT NULL** + NO ACTION |

Esta FK (quién generó el token) no puede convertirse a SET NULL sin un `drop not null` (los
tokens generados por el target dejarían un hueco), y los tokens **no tienen valor archivístico**:
son credenciales transitorias de un solo uso. Decisión (D-x, detalle en Decisiones): el servicio
los **purga explícitamente** (paso 6: `admin.from("password_reset_tokens").delete().eq("created_by", userId)`)
antes del `deleteUser`, y la migración 0054 concede **`grant delete` a `service_role`** porque la
0035 solo había otorgado insert/select/update — sin ese grant, el purge fallaría con 42501
(permission denied) y el borrado físico nunca se completaría.

---

## Decisión

### D1 — Soft-delete transitorio (`deleted_at`) como salvaguarda; el borrado físico ocurre en el mismo flujo

`umsuka.profiles` gana `deleted_at timestamptz` (nullable). El servicio lo fija **antes** del
`deleteUser` (paso 5, antes del paso 7). Propósito: si el borrado físico falla, la cuenta ya no
es visible ni operativa en la app — el perfil queda deshabilitado y excluido de todos los paths
de lectura, en vez de un "medio borrado" en el que el usuario de auth sigue existiendo pero con
estado inconsistente.

Se consideró y rechazó el **soft-delete permanente como fin** (dejar el perfil marcado y no
borrar `auth.users`): los criterios de aceptación exigen borrar el usuario de auth y sus datos;
un perfil fantasma retendría PII en la BD indefinidamente. El soft-delete es, por tanto,
**transitorio por diseño**: salvaguarda intermedia del mismo flujo síncrono, no un destino. No
hay job de limpieza asíncrono: la ventana soft-deleted dura milisegundos en el caso feliz, y en
el caso de fallo queda como estado seguro y visible de "pendiente de reintento" (ver D9).

### D2 — Contenido con autor: SET NULL (anonimización) en vez de CASCADE

Las seis FKs del Grupo C se convierten a `ON DELETE SET NULL`. Razonamiento:

- **Motivo funcional**: las FKs NO ACTION harían fallar `deleteUser` con violación de integridad
  en cuanto el target tuviera un evento, noticia, pregunta o comentario. SET NULL es la única
  opción que permite el borrado físico sin tocar el contenido.
- **Contra CASCADE**: el contenido (eventos con asistentes, noticias publicadas, preguntas y sus
  hilos de comentarios, marcas de asistencia ajenas, aliases como registro de auditoría) tiene
  valor para la comunidad y para el histórico; borrarlo en cascada destruiría datos ajenos a la
  cuenta (un evento no es "del usuario", es de la comparsa; el `marked_by` señala quién marcó,
  no a quién se marcó).
- **Contra anonimización completa (reescribir el contenido)**: estas filas no almacenan PII del
  autor — solo su id —; nullar el id es anonimización suficiente. Reescribir (p. ej. sustituir
  por un pseudónimo) añadiría migraciones de datos sin beneficio de privacidad.
- **Contra RESTRICT explícito**: bloquearía el borrado físico — exactamente lo que este sprint
  debe permitir.

Consecuencia de UI ya absorbida: los módulos que resuelven nombres de autor degradan a un
mostrado neutral ("Miembro" en preguntas/comentarios, "Usuario eliminado" en el trail de
auditoría — ADR-021 D4).

### D3 — `is_active_member()` como punto único de exclusión RLS de perfiles borrados

`umsuka.is_active_member()` (SECURITY DEFINER, `search_path = umsuka, public`) ahora exige
`status = 'active' and is_active = true and deleted_at is null`. Como todas las políticas "miembro
activo" del schema derivan de esta función (patrón RLS de los sprints anteriores), **una sola
función excluye a los perfiles soft-deleted de toda la app**. Además, la política
`profiles_select_authenticated` se recrea con `using (deleted_at is null and (umsuka.is_active_member() or id = auth.uid()))`:
un perfil soft-deleted no puede leerse ni **por sí mismo** (aunque la sesión de auth siguiera
viva) ni por nadie más.

La capa de aplicación añade el filtro `.is("deleted_at", null)` en los paths de lectura
(`getCurrentProfile` en `src/lib/auth/session.ts`, `listProfiles`/`getProfileById` en
`src/lib/profiles/queries.ts`) como defensa en profundidad — la RLS es el backstop, la query
explícita evita depender de la política (ADR-021 D7). `getCurrentProfile` además verifica
`deleted_at` explícitamente en la fila leída por si algún path futuro omitiera el filtro.

### D4 — Confirmación por la palabra fija "ELIMINAR" (no el nombre del usuario)

El diálogo pide teclear **ELIMINAR**: el botón de confirmación queda deshabilitado hasta que
`confirmation.trim().toUpperCase() === "ELIMINAR"` (client-side), y la server action lo
re-valida con idéntica regla (`deleteAccountPermanentlySchema` con refine zod, mensaje "Debes
escribir ELIMINAR para confirmar."). La decisión es **determinista y simétrica**: la palabra fija
(1) evita los falsos negativos del nombre real (diacríticos, dobles espacios, mayúsculas/orden
de apellidos) que romperían la confirmación para usuarios legítimos; (2) evita sueldos falsos
positivos si el nombre del target es genérico; (3) es comprobable de forma idéntica en cliente y
servidor sin compartir lógica de normalización de nombres; y (4) cumple el criterio de
aceptación "el sistema avisa de las consecuencias irreversibles antes de confirmar" con la misma
fuerza de compromiso que teclear el nombre. La validación vive en el servidor como autoridad
final; el deshabilitado client-side es ergonomía, no seguridad.

### D5 — Auditoría `user.deleted` + extensión del CHECK a 14 valores

El CHECK `chk_audit_logs_action` pasa de 13 a 14 acciones añadiendo `'user.deleted'` (drop +
recreate en 0054); `AUDIT_ACTIONS`/`AUDIT_ACTION_LABELS` en `src/lib/admin/schema.ts` lo espejan
en TS ("Cuenta eliminada permanentemente") y `mapAuditLogRow` sigue casteando contra el CHECK.
La emisión cumple el contrato del Sprint 21 (punto único, una sola fila):

| Campo | Valor |
|---|---|
| `action` | `user.deleted` |
| `entity_type` | `auth.user` (la entidad eliminada es el usuario de auth, no el perfil) |
| `entity_id` | el `userId` eliminado |
| `details` | `{ firstName, lastName, role }` — leídos del target en el paso 4, **antes** del borrado; el trail conserva quién era la cuenta aunque el perfil desaparezca |
| `actor_id` | el super_admin actuante (resuelto server-side) |

La fila es inmutable (append-only, ADR-021 D5) y `audit_logs.user_id` apunta al actor — que
sigue vivo — así que la fila nunca cae por el SET NULL. Best-effort como todo el trail (D3 del
ADR-021), con try/catch extra de defensa en profundidad: un fallo de auditoría **nunca** revierte
una eliminación ya completada.

### D6 — Rol validado desde la BD (`requireAuthenticatedProfile`), no desde el JWT

La autorización usa `requireAuthenticatedProfile()` y compara `actor.role !== "super_admin"` en
el servicio. El rol siempre viene de la fila `umsuka.profiles` (patrón del proyecto desde el
Sprint 6/19: "This never trusts client input for authorization: role always comes from the
database row, never from the JWT's user metadata"), y el servicio corre en código server-only
con el cliente service_role acotado al schema `umsuka`. El JWT solo prueba la sesión; el rol se
relee en cada invocación, de modo que un rol degradado o una baja/suspensión (vestigios de
estados de cuenta del Sprint 6) se reflejan al instante sin esperar expiración de token. La UI es
coherente con el mismo dato: el botón solo se renderiza para `profile.role === "super_admin"`
(no para admin).

### D7 — Anti-self: un super admin no puede eliminarse a sí mismo

Guard doble: (1) en la UI, el botón no se renderiza para la fila propia (`!isSelf`); (2) en el
servicio, `parsed.data.userId === actor.id` → `{ success: false, error: "No puedes eliminar tu
propia cuenta." }` **antes** de tocar la BD (ni siquiera se abre el cliente admin). La
protección vive en el servidor porque la UI es solo ergonomía; el draft del servicio no abre
ninguna conexión ni audita nada en el rechazo (testeado: "rejects self-deletion before touching
the database"). Sin este guard, un super admin podría eliminar la última cuenta de super admin y
dejar la app sin administración.

### D8 — Los perfiles soft-borrados no se listan en el directorio admin (borrado transitorio)

`listProfiles` (que alimenta `/admin/users`) filtra `.is("deleted_at", null)` y la política RLS
de SELECT también excluye soft-deleted: un perfil con `deleted_at` no aparece en el directorio
**ni para el super admin**. Es coherente con la naturaleza transitoria del soft-delete (D1): la
ventana de fallo no debe mostrar filas fantasma en el panel. Consecuencia aceptada: si un
`deleteUser` falla y la cuenta queda soft-deleted, ya **no se puede reintentar desde la UI**
(no hay fila de la que pulsar el botón); el reintento es una nueva llamada al servicio o SQL
manual (D9). La política `profiles_select_authenticated` solo gobierna el SELECT: las políticas
de UPDATE/DELETE de `profiles` **no se tocan** — el servicio escribe por el cliente service_role
(bypasea RLS) y ampliar esas políticas abriría superficie de ataque autenticada sin beneficio.

### D9 — Fallback y recuperación si `deleteUser` falla

El paso 7 es el único que puede dejar estado intermedio. Escenarios y salidas:

- **Fallo en el soft-delete (paso 5)** o en el purge (paso 6): error tipado y retorno inmediato;
  **nada** se ha borrado aún (el perfil sigue vivo, la cuenta intacta). El reintento desde la UI
  funciona (la fila sigue en el directorio).
- **Fallo en `deleteUser` (paso 7)**: el perfil ya está soft-deleted. Estado resultante: cuenta
  de auth existente pero **invisible e inoperativa** (RLS + queries la excluyen; aunque la sesión
  siguiera viva, `getCurrentProfile` devuelve null). Es un estado seguro: no hay media-cuenta
  visible, no hay PII expuesta, no hay datos parcialmente borrados.
- **Reintento**: vía consola/SQL o una nueva invocación del servicio. El servicio es
  **re-ejecutable e idempotente**: el soft-delete vuelve a fijar `deleted_at` (no-op), el purge
  no encuentra tokens (no-op) y `deleteUser` se reintenta. Para **resucitar** la cuenta tras un
  fallo (si se decide no eliminar), el procedimiento documentado es SQL manual por consola:
  `UPDATE umsuka.profiles SET deleted_at = NULL WHERE id = '<userId>'` — no existe (ni debe
  existir) una UI de restauración en este sprint: la resurrección es una excepción operativa, no
  un flujo de producto.
- **Borrado parcial nunca ocurre por diseño**: el único paso destructivo irreversible es el 7, y
  es el último (la auditoría del paso 8 no altera estado). Los pasos 5–6 son reversibles (SQL
  manual o no-op). La auditoría `user.deleted` solo se emite si el paso 7 tuvo éxito: **no hay
  filas de auditoría para eliminaciones fallidas** (testeado: "keeps the profile soft-deleted
  when the auth deletion fails (no audit)").

---

## Cambios de esquema (resumen de la migración 0054)

`supabase/migrations/20260101005400_account_deletion.sql`:

| # | Cambio | Detalle |
|---|---|---|
| 1 | `alter table umsuka.profiles add column deleted_at timestamptz` | Nullable, con `comment` que documenta la semántica (null = perfil vivo; excluido de todo path de lectura). Usa `add column if not exists`. |
| 2 | 6 FKs NO ACTION → SET NULL | `events.created_by`, `news.created_by`, `questions.user_id`, `question_comments.user_id` (con `drop not null` previo), `workgroup_attendance.marked_by`, `email_aliases.created_by`. Drop + recreate con los nombres por defecto `<tabla>_<columna>_fkey`; unica excepción: `question_comments.user_id` pierde el NOT NULL. |
| 3 | `grant delete on umsuka.password_reset_tokens to service_role` | La 0035 solo había otorgado insert/select/update; el purge del servicio lo exige. Único grant nuevo del sprint. |
| 4 | `is_active_member()` recreada | Añade `deleted_at is null` al predicado (SECURITY DEFINER, `search_path = umsuka, public`, grant execute a authenticated, comentario actualizado). |
| 5 | `profiles_select_authenticated` recreada | `using (deleted_at is null and (umsuka.is_active_member() or id = auth.uid()))` — drop + create. |
| 6 | `chk_audit_logs_action` ampliado | 13 → 14 (`user.deleted`), drop + recreate, comentario de columna actualizado. |

Todo el DDL de constraints se hace **sin `IF NOT EXISTS`** (patrón de la 0044/0053: una
re-ejecución falla limpiamente en lugar de re-aplicar en silencio); el `add column` sí usa
`if not exists` (idempotencia de estructura).

---

## Consideraciones de seguridad

- **Rol desde BD, nunca del JWT** (D6): el servicio re-lee el perfil del actor en cada llamada
  (`requireAuthenticatedProfile`) y exige `super_admin`; el JWT solo prueba sesión. Un admin
  simple que invocara la action directamente recibe "Solo el super admin puede eliminar
  cuentas." sin tocar la BD.
- **Anti-self** (D7): rechazo en el servicio antes de abrir el cliente admin; la UI además no
  renderiza el botón para la propia fila.
- **Sin grants amplios**: exactamente **un** grant nuevo (`delete` sobre `password_reset_tokens`
  a `service_role`); cero grants nuevos sobre `profiles` (el servicio escribe con el cliente
  service_role existente, que bypasea RLS por diseño). Las políticas de UPDATE/DELETE de
  `profiles` no se amplían ni se duplican (nota explícita en la migración): el camino de
  escritura queda exclusivamente en el servicio server-only.
- **`SECURITY DEFINER` con `search_path` fijo**: `is_active_member()` se recrea con
  `set search_path = umsuka, public` y llamadas schema-qualified (hardening contra hijacking de
  search_path, patrón ADR-021 D10); el `grant execute` explícito a `authenticated` conserva la
  cadena existente.
- **Código server-only**: `delete-account.ts` (y `src/lib/supabase/admin.ts`) importan
  `server-only` — fallo de build si algún bundle de cliente los arrastra; la service key nunca
  sale del servidor.
- **Validación determinista en servidor**: `deleteAccountSchema` (uuid) y
  `deleteAccountPermanentlySchema` (palabra ELIMINAR, trim + case-insensitive) — la confirmación
  client-side es ergonomía, la autoridad es el servidor.
- **Documentación del checklist**: sin entorno Supabase local, el SQL es hand-reasoned y queda
  sujeto a la revisión manual de la migración (sección siguiente).

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| (a) CASCADE total: borrar en cascada también eventos/noticias/preguntas/comentarios (Grupo C) | Destruiría contenido comunitario ajeno a la cuenta (eventos con asistentes, hilos de preguntas) y el trail de `marked_by`; SET NULL conserva el contenido y anonimiza el autor, que es lo que exige privacidad (D2). |
| (b) Soft-delete permanente como fin (no borrar `auth.users`) | Los criterios exigen borrar el usuario de auth y sus datos; un perfil fantasma retendría PII indefinidamente y dejaría credenciales activas en auth. El soft-delete es solo salvaguarda transitoria del flujo (D1). |
| (c) Confirmación tecleando el nombre del usuario | Falsos negativos por normalización (diacríticos, espacios, mayúsculas) y comparación no determinista entre cliente y servidor; la palabra fija ELIMINAR es determinista y simétrica (D4). |
| (d) Autorizar por el rol del JWT (user metadata) | El rol del JWT puede quedar obsoleto (cambio de rol, baja, suspensión) y es mutable; el proyecto lee el rol de la BD en todos los guards desde el Sprint 6/19 (D6). |
| (e) Trigger SQL `SECURITY DEFINER` para el purge de tokens | El purge es parte de un flujo TS con autorización ya resuelta; un trigger duplicaría lógica y no sería verificable sin entorno local — mismo razonamiento que ADR-021 D2 (purge en servicio + grant mínimo). |
| (f) Anonimización completa del contenido (reescribir autor por pseudónimo) | Las filas no contienen PII del autor (solo su id); nullar es anonimización suficiente sin migración de datos (D2). |
| (g) `password_reset_tokens.created_by` a SET NULL + drop NOT NULL | Los tokens son credenciales transitorias de un solo uso sin valor archivístico; purgarlos en el servicio es más limpio que dejar filas con creador null (caso especial de la auditoría). |
| (h) Dejar el perfil visible en el directorio admin durante la ventana soft-deleted | Mostrar "filas fantasma" en `/admin/users` confundiría al panel y no aporta nada: el estado transitorio es un fallo, no un estado de gestión (D8). |

---

## Edge cases manejados

| Escenario | Comportamiento |
|---|---|
| Usuario con sesión viva tras el soft-delete (deleteUser aún no corrió o falló) | RLS lo corta: `profiles_select_authenticated` exige `deleted_at is null` → no puede leer su propia fila; además `getCurrentProfile` filtra `.is("deleted_at", null)` y verifica `deleted_at` explícito (defensa en profundidad) → tratado como no autenticado, redirect a login. Tras el `deleteUser` exitoso, el token deja de ser válido en auth. |
| Auto-heal de `getCurrentProfile` intentando resucitar un perfil soft-deleted | El auto-heal (`ensureProfileExists`, solo para cuentas sin fila de perfil) usa upsert con `onConflict: "id", ignoreDuplicates: true`: la fila existe (con `deleted_at`), `ignoreDuplicates` impide el UPDATE → **no resucita** el perfil; el re-read devuelve null y la sesión se trata como inexistente. Caso límite: si la fila fuera legítimamente ausente (legacy), el upsert crea un perfil nuevo sin `deleted_at`. |
| Preguntas/comentarios con autor null tras la eliminación | `question_comments.user_id` es nullable (tipado en `database.types.ts` y documentado en `questions/queries.ts`); la resolución de nombres falla al "Miembro" (`authorFirstName ?? "Miembro"`); las queries no rompen. |
| `deleteUser` falla (paso 7) | Perfil soft-deleted seguro e invisible; sin fila de auditoría (no hubo eliminación); reintento idempotente del servicio o resurrección manual SQL (D9). |
| Borrado parcial (pasos 5–6 OK, paso 7 falla) | Estado intermedio documentado (D9): cuenta de auth viva pero inoperante; cero elecciones destructivas irreversibles antes del paso 7 (auditoría tras él). |
| Admin (no super_admin) invocando la action directamente | El servicio (rol desde BD) responde "Solo el super admin puede eliminar cuentas." sin abrir el cliente admin; la UI además no renderiza el botón. |
| Super admin intentando eliminarse | Anti-self en el servicio antes de tocar la BD (testeado); el botón no se renderiza para la propia fila. |
| Target inexistente o id no-uuid | `maybeSingle` → "El usuario no existe."; `deleteAccountSchema` → "El id de usuario no es válido."; en ambos casos sin escrituras (testeado). |
| Confirmación inválida (no "ELIMINAR") en la action | Refine zod → "Debes escribir ELIMINAR para confirmar."; el servicio ni se invoca. |
| Fallo del soft-delete o del purge | Error tipado y retorno inmediato: el perfil sigue vivo y la UI puede reintentar (la fila sigue en el directorio). |
| Auditoría fallida tras una eliminación exitosa | `logAuditAction` best-effort + try/catch: la eliminación reporta éxito y el trail puede quedar sin fila (consistencia eventual aceptada, ADR-021 D3). |
| Actor del trail eliminado en el futuro | Irrelevante para esta action (el actor es el super_admin vivo); el caso general ya lo cubre ADR-021 D4 ("Usuario eliminado"). |
| Cierre del diálogo mientras corre la eliminación | `onOpenChange` ignora close/Escape/overlay durante `isPending` — el usuario ve el feedback pendiente/error en vez de un diálogo cerrado con la operación a medias. |

---

## Consecuencias

### Positivas

- **Eliminación real y completa**: usuario de auth, perfil y datos propios (Grupos A y D)
  desaparecen; contenido comunitario sobrevive anonimizado (Grupo C); histórico archivístico
  sobrevive (Grupo B, incluido el trail del Sprint 21 que se diseñó para esto).
- **Privacidad efectiva**: sin PII residual del eliminado en perfiles, notificaciones, turnos,
  asistencias, ausencias, votos, inscripciones, comentarios propios, preferencias, intentos de
  contraseña ni alias de email; el contenido ajeno solo conserva el id nullado.
- **Salvaguarda de fábrica**: el soft-delete previo convierte cualquier fallo en un estado
  seguro e invisible, nunca en un medio borrado.
- **Auditoría completa y fiable**: `user.deleted` (14ª acción) con `{firstName, lastName, role}`
  del target leídos pre-borrado; append-only; sin filas para intentos fallidos.
- **Sin superficie nueva**: un único grant (`delete` de tokens a `service_role`); políticas de
  `profiles` intocadas; exclusión RLS por `is_active_member()` reutilizando un punto único.
- **Suite verde**: tests unitarios nuevos del servicio (validación, autorización, anti-self,
  target inexistente, errores por paso, fallo del deleteUser sin auditoría, auditoría
  best-effort), de la server action (confirmación ELIMINAR, delegación, revalidación) y del
  componente (doble paso, deshabilitado, cierre bloqueado durante pending); suite completa,
  `tsc --noEmit` y `eslint . --max-warnings=0` limpios; security scan sin issues HIGH (task file
  en estado `security-cleared`).

### Riesgos / pendientes

- **La migración 0054 debe aplicarse antes del deploy**: el servicio purga tokens y el path de
  lectura filtra `deleted_at`; sin la migración, el `deleteUser` fallaría por las FKs NO ACTION
  remanentes. Pendiente de verificación manual (no hay entorno Supabase local).
- **Soft-deletes huérfanos**: si `deleteUser` falla y nadie reintenta ni resucita, la cuenta de
  auth queda viva pero invisible — no es un hueco de seguridad (RLS la excluye), pero es un
  remanente de auth pendiente de resolución operativa (D9).
- **Sin restauración por UI**: resucitar una cuenta tras un fallo requiere SQL manual
  (`UPDATE profiles SET deleted_at = NULL`) — excepción operativa deliberada, documentada.
- **`email_aliases.created_by` corregido en la auditoría**: el inventario preliminar (plan) lo
  catalogaba como FK a `auth.users`; el DDL real referencia `profiles(id)` — efecto idéntico
  bajo el CASCADE de 0001, documentado en el Grupo C.
- **PR y pipeline**: los cambios viven en el working tree (rama aún no creada en el repo, según
  `docs/git-conventions.md`); el PR posterior (visible en el historial de la rama) y el escaneo
  security-champion los gestiona el pipeline estándar.

---

## Revisión SQL manual (pendiente)

No hay Docker/Supabase local disponible en el entorno de implementación; el SQL es hand-reasoned.
La migración 0054 incluye su propio checklist (sección final del archivo). Resumen de lo que hay
que verificar antes del deploy:

- [ ] `umsuka.profiles` tiene `deleted_at timestamptz` nullable.
- [ ] `pg_constraint` muestra ON DELETE SET NULL en: `events_created_by_fkey`,
      `news_created_by_fkey`, `questions_user_id_fkey`, `question_comments_user_id_fkey`,
      `workgroup_attendance_marked_by_fkey`, `email_aliases_created_by_fkey`;
      `question_comments.user_id` es ahora nullable.
- [ ] `umsuka.is_active_member()` incluye `deleted_at is null`; un perfil soft-deleted devuelve
      false.
- [ ] `profiles_select_authenticated` excluye soft-deleted; un soft-deleted no puede leer ni su
      propia fila.
- [ ] Un super admin puede actualizar un perfil con `deleted_at` vía cliente service_role (RLS
      bypass); la política autenticada de UPDATE queda intacta (own-or-admin, como antes).
- [ ] `chk_audit_logs_action` acepta las 14 acciones y rechaza cualquier otro valor; insertar
      `action='user.deleted'` funciona.
- [ ] `service_role` tiene DELETE sobre `umsuka.password_reset_tokens` (grant de la sección 3);
      los paths no autenticados/no autorizados y cada paso de infraestructura de
      `deleteAccountPermanently()` devuelven errores tipados en vez de lanzar.
- [ ] Eliminar un usuario de auth con filas en events/news/questions/question_comments/
      workgroup_attendance (como marcador)/email_aliases tiene éxito (FKs a null) y falla
      limpiamente si quedan filas que referencien al perfil (`password_reset_tokens.created_by`
      se purga antes del delete).
- [ ] `supabase db push` aplica la migración; la re-ejecución falla limpiamente en los nombres de
      constraint duplicados (el `drop constraint if exists` lo suaviza).

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101005400_account_deletion.sql` | CREATE — `profiles.deleted_at` (nullable, comentado), 6 FKs NO ACTION → SET NULL (incl. `drop not null` de `question_comments.user_id`), grant DELETE de `password_reset_tokens` a `service_role`, `is_active_member()` con `deleted_at is null`, `profiles_select_authenticated` recreada, `chk_audit_logs_action` 13→14 con comentario, checklist manual |
| `src/types/database.types.ts` | MODIFY — `profiles.deleted_at` (Row/Insert/Update) y `question_comments.user_id` nullable (Row/Insert/Update); las demás columnas del Grupo C ya eran nullable en el schema (hand-authored, nunca regenerado) |
| `src/lib/auth/delete-account.ts` | CREATE — `deleteAccountPermanently(userId)` (8 pasos: validar → rol super_admin desde BD → anti-self → leer target → soft-delete → purge de tokens → `admin.auth.admin.deleteUser()` → auditar `user.deleted` best-effort), `deleteAccountSchema`, `DeleteAccountResult` errrors tipados por paso, JSDoc del flujo |
| `src/app/admin/users/actions.ts` | MODIFY — `deleteAccountPermanentlySchema` (refine `ELIMINAR`, trim + mayúsculas) y `deleteAccountPermanentlyAction` (thin wrapper: valida, delega, `revalidatePath` de `/admin/users` y `/admin/registrations` en éxito) |
| `src/app/admin/users/delete-account-button.tsx` | CREATE — `AlertDialog` destructivo de doble paso: exige teclear ELIMINAR, botón confirmar deshabilitado hasta entonces, cierre bloqueado durante `isPending`, `router.refresh()` en éxito, errores en el diálogo |
| `src/app/admin/users/page.tsx` | MODIFY — botón renderizado solo para `profile.role === "super_admin"` y `!isSelf` |
| `src/components/ui/alert-dialog.tsx` | CREATE — componente shadcn/ui base para el diálogo |
| `src/lib/admin/schema.ts` | MODIFY — `AUDIT_ACTIONS`/`AUDIT_ACTION_LABELS` 13 → 14 (`user.deleted` = "Cuenta eliminada permanentemente"), comentario del CHECK 0053+0054 |
| `src/lib/auth/session.ts` | MODIFY — `fetchProfileRow` con `.is("deleted_at", null)` + verificación explícita de `deleted_at` en la fila (defensa en profundidad, excluye soft-deleted de la sesión) |
| `src/lib/profiles/queries.ts` | MODIFY — `listProfiles`/`getProfileById` con `.is("deleted_at", null)` (los soft-deleted no se listan ni consultan) |
| `src/lib/questions/queries.ts` | MODIFY — `QuestionComment.userId` nullable documentado y fallback de autor "Miembro" para contenido anonimizado por 0054 |
| `tests/unit/lib/delete-account.test.ts` | CREATE — 8 tests del servicio: flujo completo (soft-delete → purge → deleteUser → audit única con details), rechazo de no-super-admin sin tocar la BD, anti-self antes de tocar la BD, target inexistente, error de soft-delete sin pasos posteriores, fallo de deleteUser mantiene el perfil soft-deleted **sin auditoría**, auditoría fallida → éxito reportado, id inválido |
| `tests/unit/lib/delete-account-action.test.ts` | CREATE — server action: refine ELIMINAR (rechazo y mensaje), delegación al servicio, `revalidatePath` solo en éxito, errores tipados del catch |
| `tests/unit/components/delete-account-button.test.tsx` | CREATE — componente: doble paso (deshabilitado sin ELIMINAR), confirmación correcta, error mostrado en el diálogo, cierre bloqueado durante pending, refresh tras éxito |
| `tests/unit/lib/admin-schema.test.ts`, `tests/unit/components/admin-audit-log-view.test.tsx` | MODIFY — cobertura del 14º valor (`user.deleted`) en constantes/schema y de su label en la vista de auditoría |
| `docs/adr-sprint-22-account-deletion.md` | CREATE — este ADR |

---

## Referencias

- Task file: `tasks/sprint-22-account-deletion.json` (criterios de aceptación, DoD — incluye el
  ADR como entregable, estado `security-cleared`; el ADR fue marcado como **MAJOR pendiente** por
  el QA y se cierra con este documento).
- Plan: `tasks/plan-desarrollo-completo.md` → "Sprint 22 — Eliminación Permanente de Cuentas
  (Solo Super Admin)" (rama `feature/sprint-22-account-deletion`, pasos 1–8).
- PR del sprint 22: posterior al cierre de este ADR (los cambios viven en el working tree);
  convenciones de rama/commits en `docs/git-conventions.md`.
- ADR-021 (Sprint 21 — Admin Panel): `audit_logs` con `user_id` SET NULL (D4) preparó este
  sprint; `logAuditAction` best-effort (D3) y append-only (D5) rigen la auditoría de
  `user.deleted`; `get_user_emails` (D10) es el patrón SECURITY DEFINER con search_path fijo.
- ADR-020 (Sprint 20 — Notificaciones): patrón del emisor best-effort que replica el trail.
- Sprint 6 (Registration Approval): estados de cuenta (`status`) que conviven con `deleted_at`
  (ortogonales: el soft-delete no reutiliza `suspended`/`pending`).
- Migraciones verificadas para la auditoría: 0001, 0002, 0004–0008, 0011, 0015, 0018, 0028,
  0034, 0035, 0039, 0040, 0045, 0046, 0050, 0052, 0053 y 0054 (nombres de constraint en formato
  por defecto `<tabla>_<columna>_fkey`).