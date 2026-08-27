# Auditoría — Notificaciones por preferencias y audiencia

**Rama:** `feature/notifications-preferences-check` · **Fecha:** 2026-08-27 · **Estado:** Verificado — sin cambios funcionales requeridos

## Objetivo
> Cuando se cree una nueva votación, evento, noticia… que se mande una notificación a todos los que tienen que contestar en función de sus preferencias.

Se solicitó crear una rama nueva y **revisar si ya está implementado**.

## Veredicto
**SÍ, YA ESTÁ IMPLEMENTADO y es correcto** desde los Sprint 20 (Notificaciones) + 18 (Audience). No hace falta código nuevo.

## Evidencia

### 1. Capa central `notifyUsers` ya honra preferencias
`src/lib/notifications/emit.ts:153-211`:

```ts
export async function notifyUsers({userIds, type, title, message, link}): Promise<void> {
  const uniqueIds = [...new Set(userIds)];
  const admin = createAdminClient();
  const { data: preferenceRows } = await admin.from("notification_preferences")
    .select("user_id, types").in("user_id", uniqueIds);
  const typesByUser = new Map(preferenceRows.map(r => [r.user_id, r.types]));
  const recipients = uniqueIds.filter(userId => {
    const types = typesByUser.get(userId);
    if (types === undefined || types.length === 0) return true; // legacy o [] = todo
    return types.includes(type);
  });
  await admin.from("notifications").insert(recipients.map(...));
}
```

* `types === undefined` (sin fila legacy migration 0052) o `types=[]` → **recibe todo**.
* `types` no vacío → **opt-out**: solo recibe si incluye el `type`.
* Single `INSERT` por batch, `try/catch` best-effort (nunca rompe la mutación de negocio), `service_role` bypass RLS, `server-only`.

### 2. Eventos — audiencia + preferencias
`src/lib/events/mutations.ts:222-247` (crear evento):

```ts
const recipients = await resolveEventRecipients({
  audience_type, audience_workgroup, audience_member_type, audience_user_ids
});
await notifyUsers({ userIds: recipients, type: "event_created", title, link: `/events/${id}` });
```

`resolveEventRecipients` (`emit.ts:87-144`): `all → getAllActiveMemberIds()`, `workgroup → profiles where workgroup = X`, `member_type → component_type = X`, `specific_users → dedup list`. Luego `notifyUsers` filtra por preferencias.

### 3. Votaciones — todos los activos
`src/lib/votings/mutations.ts:114`:

```ts
await notifyUsers({ userIds: await getAllActiveMemberIds(), type: "voting_created", title: `Nueva votación: ${title}`, link: `/votings/${id}` });
```

### 4. Noticias — solo si publicada
`src/lib/news/mutations.ts:83`:

```ts
if (parsed.data.published) {
  await notifyUsers({ userIds: await getAllActiveMemberIds(), type: "news_created", title: `Nueva noticia: ${title}`, link: `/news/${id}` });
}
```

Drafts son silenciosos.

### 5. Turnos / aprobaciones — mismo patrón
* `src/lib/shifts/assignments.ts:368` → `shift_assigned`
* `src/lib/approvals/mutations.ts:54` → `profile_approved`

### 6. Preferencias — almacenamiento y UI
* Tabla `notification_preferences (user_id PK, types text[])` RLS `own-row`, Zod `updateNotificationPreferencesSchema` (`types: []` = todo), `mapPreferenceRow` → `getMyNotificationPreferences`.
* UI `src/app/notifications/*` + `NotificationPreferencesCard` + `hooks.ts` permite activar/desactivar `event_created`, `news_created`, `voting_created`, `shift_assigned`, `profile_approved` por usuario.

## Qué significa “todos los que tienen que contestar”

| Entidad | “Tienen que contestar” | Implementado como |
|---|---|---|
| Votación | Todos los miembros activos (pueden votar) | `getAllActiveMemberIds()` → `notifyUsers` filtra `voting_created` |
| Evento | Solo la audiencia configurada (all / workgroup / member_type / specific) | `resolveEventRecipients(audience)` → `notifyUsers` filtra `event_created` |
| Noticia | Todos los activos si es publicada (informativa) | `getAllActiveMemberIds()` si `published` → `news_created` |
| Turno asignado | El asignado | `user_id` concreto → `shift_assigned` |

En todos los casos **se respeta `notification_preferences`** antes de insertar.

## Tests / Best-effort
* `notifyUsers` nunca hace `throw` (log + `return`), el `create*` tampoco (`try { await notifyUsers } catch { log }`).
* Cobertura en `tests/unit/lib/notifications-*` y `emit` helpers (sin flakiness en CI).

## Conclusión
Crear la rama `feature/notifications-preferences-check` como trazabilidad. **No se propone PR funcional**: el comportamiento solicitado ya existe y es testeable en `master` tras el merge de Sprint 33 (`1e72aed`). Si se desea, añadir un test E2E `crear votación/evento/noticia → verificar notifications` filtradas por preferencias, pero no es bloqueo.

## Referencias
* `src/lib/notifications/emit.ts`, `queries.ts`, `mutations.ts`, `schema.ts`
* `src/lib/events/mutations.ts:27,222`
* `src/lib/votings/mutations.ts:4,115`
* `src/lib/news/mutations.ts:4,84`
* `tasks/sprint-20-notifications.json`, `docs/adr-sprint-20-notifications.md`
* Migración `umsuka.notification_preferences`
