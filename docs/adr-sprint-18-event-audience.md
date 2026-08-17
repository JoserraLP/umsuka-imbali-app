# ADR-018: Sprint 18 — Segmentación de Audiencia en Eventos (Event Audience)

**Status:** Accepted · **Date:** 2026-08-16

---

## Context

Hasta el Sprint 17, la visibilidad de un evento se restringía de una sola forma: la columna
`visible_to_group` (Sprint 12) limita un evento a un único grupo de trabajo (`work_shift`).
Los eventos generales se mostraban a todos los miembros activos. No existía forma de dirigir
un evento a un subconjunto de la membresía: un grupo concreto, un tipo de miembro
(`component_type`) o usuarios específicos.

Se requería:

- Al crear un evento, elegir su audiencia: todos, un grupo de trabajo, un tipo de miembro o
  usuarios concretos (multi-select con búsqueda).
- Los eventos restringidos solo aparecen para sus destinatarios (feed, calendario, dashboard,
  detalle).
- El creador y management pueden ver la audiencia configurada de cada evento y modificarla
  después de creado.
- Los eventos `work_shift` (Sprint 12) mantienen su semántica: siempre visibles para su grupo
  (`visible_to_group`), sin segmentación adicional.
- Seguridad: defensa en profundidad (Zod + autorización en servidor + RLS).

### Restricciones heredadas

- El RLS `events_select_authenticated` (Sprint 12) ya combina `visible_to_group` con
  `is_management()`; la política se **reemplaza** combinando además la audiencia, sin tocar las
  políticas INSERT/UPDATE/DELETE (lead/management) existentes.
- No hay entorno Supabase local ni CLI disponible en el entorno de implementación: el SQL es
  hand-reasoned y queda **pendiente de verificación manual** (checklist en
  [Revisión SQL manual](#revisión-sql-manual-pendiente)); `src/types/database.types.ts` se edita
  a mano (nunca se regenera con el CLI).
- `src/app/events/actions.ts` (`createEventAction`/`updateEventAction`) se mantiene **sin
  cambios**: sigue exportado para las rutas legacy.

---

## Decisión

### D1 — Una única migración `20260101005000_event_audience.sql`

La migración contiene, en orden: (1) enum `umsuka.audience_type` idempotente; (2) tres columnas
en `umsuka.events`; (3) CHECK constraints de coherencia y whitelists; (4) índices y comentarios;
(5) función `umsuka.current_user_component()`; (6) tabla `umsuka.event_audience_users`;
(7) RLS de la tabla; (8) reescritura de `events_select_authenticated`. Todo el sprint de BD cabe
en un único archivo por la naturaleza cohesiva del cambio (una sola feature de audiencia).

### D2 — Columnas: enum + TEXT con CHECK (sin casts en la policy)

| Columna | Tipo | Default | Descripción |
|---|---|---|---|
| `audience_type` | `umsuka.audience_type` (enum `all`/`workgroup`/`member_type`/`specific_users`) | `'all'` NOT NULL | Alcance de la audiencia |
| `audience_workgroup` | `text` nullable | — | Grupo objetivo cuando `audience_type = 'workgroup'` |
| `audience_member_type` | `text` nullable | — | Tipo de miembro objetivo cuando `audience_type = 'member_type'` |

`audience_workgroup`/`audience_member_type` son **TEXT** (no los enums `workgroup`/`component_type`)
para que la policy SELECT los compare directamente con `current_user_workgroup()` /
`current_user_component()` sin casts de enum. La coherencia se garantiza con CHECK:

```sql
-- audience_workgroup solo tiene sentido cuando audience_type = 'workgroup'
chk_events_audience_workgroup_requires_type:  audience_workgroup is null or audience_type = 'workgroup'
-- Whitelist (espejo del enum Zod del cliente)
chk_events_audience_workgroup_value:          audience_workgroup is null or audience_workgroup in ('telas','barra','estandarte','limpieza')
chk_events_audience_member_type_requires_type: audience_member_type is null or audience_type = 'member_type'
chk_events_audience_member_type_value:        audience_member_type is null or audience_member_type in ('music','dance','member')
```

Los CHECK se crean **sin `IF NOT EXISTS`** (patrón de la migración 0044): si la migración se
ejecuta dos veces sobre la misma BD fallará limpiamente, lo cual es preferible a una re-ejecución
silenciosa con estado incierto. Las columnas sí usan `ADD COLUMN IF NOT EXISTS` (idempotencia de
estructura).

### D3 — Los `work_shift` SIEMPRE son audiencia `'all'` (regla de pin)

Los eventos de trabajo (Sprint 12) expresan su audiencia con `visible_to_group`; la
segmentación Sprint 18 no aplica a ellos:

- **Servidor**: `resolveAudienceFields(actor, input)` (en `src/lib/events/audience.ts`) fuerza
  `audienceType: 'all'` con todos los compañeros a `null`/`[]` cuando `eventType === 'work_shift'`.
  Una petición manipulada que envíe cualquier audiencia no-default se rechaza con
  `"Los eventos de trabajo solo pueden mostrarse a su grupo de trabajo."` **antes** de tocar la BD.
- **UI**: la sección "¿A quién se muestra?" se oculta para leads (`canConfigureAudience = false`)
  y se muestra deshabilitada con nota informativa cuando el tipo seleccionado es `work_shift`
  (caso management en el formulario).
- Como consecuencia, las políticas INSERT/UPDATE/DELETE de eventos de Sprint 12 (lead/management)
  quedan **intactas**: la app nunca escribe una audiencia distinta de `'all'` en un `work_shift`.

### D4 — RLS de `event_audience_users`: SELECT propia O management O creador (la "trampa" own-row)

```sql
create policy "event_audience_users_select_own_or_management_or_creator"
  on umsuka.event_audience_users for select
  to authenticated
  using (
    user_id = auth.uid()
    or umsuka.is_management()
    or exists (
      select 1 from umsuka.events e
      where e.id = event_id
        and e.created_by = auth.uid()
    )
  );
```

**La cláusula `user_id = auth.uid()` es obligatoria** (no es un lujo): el mirror de visibilidad
del feed (`listEvents`/`getEventById`) lee, **a través del cliente autenticado**, qué eventos
contienen al viewer (`getMyAudienceEventIds`). Sin la cláusula own-row, un miembro no-management
nunca podría resolver su conjunto de audiencia y el feed de `specific_users` se rompería
completamente. La membresía de un usuario es información sobre sí mismo; no se filtra
información ajena (solo se devuelve `event_id` de sus propias filas).

### D5 — INSERT/UPDATE/DELETE de `event_audience_users`: management O creador

```sql
with check (umsuka.is_management() or exists (
  select 1 from umsuka.events e
  where e.id = event_id and e.created_by = auth.uid()
))
```

Mismo criterio en las tres políticas (INSERT con `with check`; UPDATE y DELETE con `using` +
`with check`). La rama "creador" cubre el caso del responsable de grupo dueño de su `work_shift`
(defensivo: nunca escribe filas de audiencia porque su evento es `'all'`, pero el RLS no debe
bloquearle si algún día un flujo futuro lo intentara) y el caso general de un creador leyendo la
audiencia de su evento (D4).

### D6 — Schemas: `AUDIENCE_FORM_FIELDS` en los schemas de evento existentes

La capa de audiencia se divide en **dos módulos** para mantener el bundle del cliente libre de
imports server-only (`next/headers` vía `@/lib/supabase/server`, `server-only` vía la cadena de
auth): un componente cliente que importe `audience.ts` rompería el build ("You're importing a
component that needs next/headers").

- `src/lib/events/audience-shared.ts` — **client-safe (isomórfico)**, solo importa `zod` y tipos;
  define y exporta:

- `AUDIENCE_TYPES`, `AudienceTypeValue`, `AUDIENCE_MEMBER_TYPES`, `AudienceMemberType`,
  `AUDIENCE_WORKGROUPS` (espejo local de `EVENT_WORKGROUPS`, ver ciclo de módulos).
- `AUDIENCE_FORM_FIELDS` — los cuatro campos, todos opcionales con defaults:
  - `audienceType`: `z.enum(AUDIENCE_TYPES).default("all")`.
  - `audienceWorkgroup`: `z.preprocess(''|null|undefined → null, z.enum(AUDIENCE_WORKGROUPS).nullable())`.
  - `audienceMemberType`: `z.preprocess(→ null, z.enum(["music","dance","member"]).nullable())`.
  - `audienceUserIds`: `z.array(z.string().uuid()).default([])`.
- `audienceCrossFieldIssueFn` — `superRefine` compartido: `workgroup` requiere grupo
  (`"Debes elegir el grupo de trabajo al que se muestra el evento."`), `member_type` requiere tipo
  (`"Debes elegir el tipo de miembro al que se muestra el evento."`), `specific_users` requiere
  ≥1 usuario (`"Debes seleccionar al menos un usuario."`). Mensajes en español.
- `audienceSchema` / `AudienceValues` (sección standalone, usada por el editor rápido) y
  `updateEventAudienceSchema` / `UpdateEventAudienceInput`.

`src/lib/events/audience.ts` (servidor) re-exporta todo lo anterior con `export * from
"./audience-shared"` y añade las queries, la resolución (`resolveAudienceFields`,
`replaceAudienceUsers`) y `updateEventAudience`, que requieren supabase/auth. Los componentes
cliente importan **siempre** de `audience-shared`; los módulos de servidor y los tests pueden
seguir importando de `audience` (vía re-export).

`src/lib/events/schema.ts` extiende `eventFormSchema`, `createEventSchema` y `updateEventSchema`
con `{ ...EVENT_FORM_FIELDS, ...AUDIENCE_FORM_FIELDS }` y encadena
`.superRefine(audienceCrossFieldIssueFn)` **después** del `.refine` de `work_shift` existente.

**Ciclo de módulos**: `schema.ts` importa valores runtime de `audience-shared` (client-safe); por
eso `audience-shared` y `audience.ts` NO importan valores runtime de `schema.ts` (solo type-only
imports). El espejo `AUDIENCE_WORKGROUPS` evita el ciclo `schema → audience → schema`.

### D7 — Mutaciones

- `createEvent`/`updateEvent` (`src/lib/events/mutations.ts`) se extienden **en el sitio**:
  `resolveAudienceFields(actor, parsed.data)` tras resolver el grupo; las tres columnas
  `audience_*` se incluyen en el INSERT/UPDATE.
- `createEvent` con `specific_users`: tras insertar el evento, `replaceAudienceUsers(eventId,
  userIds)` (delete-all + insert). Si las filas de audiencia fallan, **compensación**: se borra el
  evento recién creado y se devuelve `"No se pudo guardar la audiencia del evento."` (nunca queda
  un evento a medio configurar).
- `updateEvent`: misma resolución en las dos ramas (work_shift previo/actual); si la nueva
  audiencia es `specific_users` → replace; si se **abandona** `specific_users` → delete-all de las
  filas antiguas (`.delete().eq("event_id", id)`, permitido por RLS a management/creador).
- `createEventWithAudience` — **alias documentado de `createEvent`** definido en `mutations.ts`
  (NO en `audience.ts`): el esquema de entrada ya contiene los campos de audiencia (D6), así que
  el alias no necesita lógica propia. La UI de creación usa el server action derivado.
- `updateEventAudience` (`src/lib/events/audience.ts`) — mutación dedicada del editor rápido:
  valida `updateEventAudienceSchema`, lee el evento existente, rechaza `work_shift`, exige
  management o creador (autorización en servidor; nunca confiar solo en RLS), resuelve los campos
  y actualiza columnas + filas.

### D8 — `EventVisibility.componentType` + mirror puro en el feed

- `EventVisibility` gana `componentType: ComponentType` (**requerido**) — el typecheck encuentra
  todos los call sites del feed: `events/page.tsx`, `calendar/page.tsx`, `dashboard/page.tsx`
  (el widget de calendario recibe el objeto ya construido por prop).
- `isEventVisibleToAudience(event, ctx)` — **espejo puro** de la policy RLS, en `audience-shared.ts`
  (re-exportado desde `audience.ts`):
  1. management → `true`;
  2. regla de grupo legacy (`visible_to_group`) primero: si difiere del grupo del viewer → `false`;
  3. switch por `audience_type`: `'all'` → `true`; `'workgroup'` → igualdad con
     `ctx.userWorkgroup` (con guarda defensiva contra `'ninguno'`, que el CHECK de la BD excluye
     pero un dato corrupto nunca debe filtrarse a todo el mundo); `'member_type'` → igualdad con
     `ctx.userComponent`; `'specific_users'` → el id del evento está en `ctx.audienceEventIds`;
     tipo nulo → se comporta como `'all'` (la columna es NOT NULL con default, pero defensivo);
     tipo desconocido → **fail closed** (`false`).
- `listEvents`/`getEventById`: con `visibility` y usuario **no-management**, se obtiene el id del
  viewer con `supabase.auth.getUser()` (fallo → conjunto vacío, **fail closed**) y su conjunto de
  eventos con `getMyAudienceEventIds(userId, client)` (mismo cliente autenticado, RLS own-row,
  D4), y se filtra con el mirror. El camino management conserva el filtro de grupo legacy
  (`isEventVisibleToGroup`, que con `isManagement=true` es un no-op). `isEventVisibleToGroup`
  **sigue exportada** para compatibilidad/tests.
- `getVisibleEvents(options, visibility)` — alias de `listEvents` para las rutas del feed Sprint 18
  (`getVisibleEventsAction`).

### D9 — Badges y editor rápido

- **Lista** (`/events`): badge de audiencia solo para management o creador del evento
  (`isManagementRole(profile.role) || event.createdBy === profile.id`), y solo cuando la audiencia
  no es `'all'`. Los conteos de `specific_users` se obtienen en **una** query batcheada
  `getAudienceUserCounts(eventIds)` (`in("event_id", ...)`). El badge "Grupo: X" legacy se
  mantiene (work_shift).
- **Detalle** (`/events/[id]`): badge en la cabecera (mismo criterio); editor rápido colapsado
  (`AudienceEditor`, en `[id]/audience-editor.tsx`) que reutiliza `AudienceSelector`, se respalda
  en `updateEventAudienceAction` y hace `router.refresh()` tras guardar. Para `work_shift` se
  muestra una **nota estática** en lugar del editor. El `EventForm` de edición del detalle oculta
  la sección (el editor rápido es la superficie de audiencia del detalle) y hace round-trip de los
  valores de audiencia por `defaultValues` (imprescindible para que una edición de datos no
  reseteé una audiencia `specific_users`).
- `getAudienceSummary(event, userCount?)` — resumen human-readable: `"Solo grupo: Barra"`,
  `"Solo Música"`, `"Usuarios concretos (3)"`; cae a `visible_to_group` cuando la audiencia es
  `'all'` y hay grupo legacy; `null` para audiencia plana.
- `getEventAudience(eventId)` — configuración completa (tipo + valores + usuarios resueltos);
  `getEventAudienceUsers(eventId)` — usuarios con nombres (patrón 2 queries + Map de
  `getEventComments`); `getAudienceOptions()` — miembros activos candidatos (patrón de
  `getAvailableMembers`).

### D10 — Nombrado y etiquetas

La columna se llama **`audience_member_type`** (según el task file), sus valores son los de
`component_type` (`music`/`dance`/`member`), y las etiquetas reutilizan las existentes en español:
"Música" / "Baile" / "Socio/a" (`AUDIENCE_MEMBER_TYPE_LABELS`). `AUDIENCE_TYPE_LABELS`:
"Todos los miembros" / "Solo mi grupo de trabajo" / "Solo un tipo de miembro" / "Usuarios
concretos".

### Política `events_select_authenticated` (reemplazada, texto completo)

```sql
drop policy if exists "events_select_authenticated" on umsuka.events;
create policy "events_select_authenticated"
  on umsuka.events for select
  to authenticated
  using (
    umsuka.is_management()
    or (
      (
        visible_to_group is null
        or visible_to_group::text = umsuka.current_user_workgroup()::text
      )
      and (
        audience_type = 'all'
        or (audience_type = 'workgroup' and audience_workgroup = umsuka.current_user_workgroup()::text)
        or (audience_type = 'member_type' and audience_member_type = umsuka.current_user_component()::text)
        or exists (
          select 1 from umsuka.event_audience_users eau
          where eau.event_id = umsuka.events.id
            and eau.user_id = auth.uid()
        )
      )
    )
  );
```

La regla es **intersección** (grupo AND audiencia): el `visible_to_group` sigue filtrando dentro
de la rama no-management (los `work_shift` no cambian su comportamiento de Sprint 12) y la
audiencia añade una segunda barrera para los eventos restringidos. Management sigue viéndolo todo.

Derivación booleana de la política (`actor` = usuario autenticado, `e` = evento):

```
visible(actor, e)  = is_management(actor)
                     OR ( grupo(actor, e) AND audiencia(actor, e) )

grupo(actor, e)    = visible_to_group IS NULL
                     OR visible_to_group = current_user_workgroup(actor)

audiencia(actor,e) = audience_type = 'all'
                     OR ( audience_type = 'workgroup'
                          AND audience_workgroup = current_user_workgroup(actor) )
                     OR ( audience_type = 'member_type'
                          AND audience_member_type = current_user_component(actor) )
                     OR ∃ r ∈ event_audience_users:
                        r.event_id = e.id AND r.user_id = actor.id
```

El mirror `isEventVisibleToAudience` (D8) implementa exactamente esta tabla de verdad en JS,
con fail closed en los bordes: tipo de audiencia desconocido → `false`, `audience_type` nulo →
se comporta como `'all'` (la columna es NOT NULL con default), y `audience_workgroup = 'ninguno'`
(dato corrupto) nunca matchea. La cláusula `∃ r …` del mirror se resuelve con
`getMyAudienceEventIds` a través del cliente autenticado (RLS own-row, D4).

### Función `umsuka.current_user_component()`

```sql
create or replace function umsuka.current_user_component()
returns text
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select component_type from umsuka.profiles where id = auth.uid();
$$;

grant execute on function umsuka.current_user_component() to authenticated;
```

Espejo exacto del patrón `current_user_workgroup()` (migración 0019): `SECURITY DEFINER` con
`search_path` restringido y grant a `authenticated`. Sin ella, la rama `member_type` de la policy
no podría comparar el componente del viewer sin RLS recursiva.

### Compatibilidad hacia atrás

- Todas las columnas/el enum/tabla son **aditivos**; el enum se crea con
  `exception when duplicate_object` y las columnas con `IF NOT EXISTS`.
- Los schemas Zod aceptan inputs pre-Sprint 18 (los campos de audiencia son opcionales con
  defaults): la suite de tests existente pasa sin cambios.
- Las filas de eventos existentes quedan con `audience_type = 'all'` (default NOT NULL aplicado
  por el `ALTER TABLE`): su visibilidad no cambia (regla de grupo legacy intacta).
- `createEventAction`/`updateEventAction` y `createEvent`/`updateEvent` siguen exportados y
  funcionales; `isEventVisibleToGroup` sigue exportada.

### Server actions (`src/app/events/audience-actions.ts`)

- `createEventWithAudienceAction(input)` → `createEventWithAudience`; revalida `/events` y
  `/calendar`.
- `updateEventAudienceAction(input)` → `updateEventAudience`; revalida `/events`, `/events/[id]`
  y `/calendar`.
- `getVisibleEventsAction(options, visibility)` → `getVisibleEvents` (solo lectura, sin
  revalidación).

### UI — `AudienceSelector` (`src/app/events/audience-selector.tsx`)

Sección "¿A quién se muestra?" gestionada con `useController`/`useWatch` de React Hook Form:
Select de tipo; condicionales por tipo: Select de grupo (Telas/Barra/Estandarte/Limpieza), Select
de tipo de miembro (Música/Baile/Socio/a) o multi-select con `Input` de búsqueda (filtra por
nombre/apellidos/username) + lista de checkboxes (checkbox plano `<input type="checkbox">` — no
existe componente Checkbox en `src/components/ui/*`) con scroll, contador de seleccionados y
badges de nombres. Al cambiar de tipo se limpian los campos del otro tipo (`setValue` a `null`);
`audienceUserIds` se conserva. Solo primitivas UI del repo; sin dependencias nuevas.

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| Tabla genérica de visibilidad (event_id, workgroup) para audiencias múltiples | Un evento con audiencia "uno de X" se modela más simple con columnas + CHECK de coherencia; la tabla se reserva para `specific_users`, que sí es un conjunto abierto. |
| Columnas tipadas con los enums `workgroup`/`component_type` | La policy tendría que castear (`::text`) para comparar con los helpers `current_user_*()`; TEXT + CHECK de whitelist evita casts y mantiene el espejo exacto con el Zod del cliente. |
| Validar la audiencia SOLO en RLS | La RLS no puede producir mensajes de error accionables ("Debes elegir el grupo...") ni validar la coherencia work_shift; el servidor valida primero (Zod + `resolveAudienceFields`) y la RLS queda como backstop. |
| `CREATE CONSTRAINT ... IF NOT EXISTS` en los CHECK | No existe `IF NOT EXISTS` para constraints en PostgreSQL; el patrón de la migración 0044 (sin guarda) hace fallar limpiamente una re-ejecución, que es el comportamiento deseado. |
| Feed filtrado solo por RLS (dejar que la BD devuelva solo lo visible) | La RLS sí filtra en la BD, pero el mirror puro en el servidor es la única forma de probar la regla sin BD, da errores 404 coherentes en el detalle y protege contra drift entre policy y aplicación. |
| Editor de audiencia dentro del `EventForm` de edición del detalle | Duplicaría la superficie con el editor rápido (D9); el detalle usa el editor rápido y el formulario hace round-trip de los valores. |
| Schema Zod separado para la audiencia (fusionado en el resolver en lugar de integrado) | Un schema aparte crearía dos caminos de validación divergentes y obligaría a mergear en cada mutación; el spread de `AUDIENCE_FORM_FIELDS` en los schemas existentes (D6) garantiza un solo resolver con validación cruzada única para los tres schemas de evento. |
| Permitir segmentación de audiencia adicional en eventos `work_shift` | `visible_to_group` ya restringe por grupo; una audiencia extra crearía un doble alcance ambiguo (grupo AND audiencia) y complicaría las políticas de escritura lead de Sprint 12, que quedan intactas con la regla de pin `'all'` (D3). |
| Conteo de badge `specific_users` con una query por evento (N+1) | El patrón del repo evita N+1 con 2 queries + Map; `getAudienceUserCounts` batchea con `in("event_id", ...)` en una sola query (D9). |
| `service_role` para las filas de audiencia | No hace falta: el REPLACE se ejecuta con el cliente autenticado del actor (management/creador), que la RLS de D4/D5 autoriza. Cero grants `service_role` nuevos. |

---

## Edge cases manejados

| Escenario | Comportamiento |
|---|---|
| `work_shift` con audiencia manipulada (p. ej. `specific_users`) | Rechazado en servidor antes de tocar la BD: "Los eventos de trabajo solo pueden mostrarse a su grupo de trabajo." |
| Lead no-management crea evento general | Rechazado (gestión requerida para audiencias + regla existente de creación). |
| `specific_users` sin usuarios (o con UUID inválido) | Schema: "Debes seleccionar al menos un usuario." / "Cada usuario debe ser un UUID válido." |
| Inserto duplicado en `event_audience_users` (23505, PK `(event_id, user_id)`) | En `createEvent` cae a la compensación (borrado del evento); en `updateEvent`/`updateEventAudience` se devuelve el error de `replaceAudienceUsers` ("No se pudo actualizar la audiencia del evento: …"). |
| Fallo al insertar filas de audiencia al crear | Compensación: el evento recién creado se borra y se devuelve error ("No se pudo guardar la audiencia del evento."). |
| Edición de un evento que era `specific_users` y deja de serlo | Delete-all de las filas antiguas (`.delete().eq("event_id", id)`). |
| `getUser()` falla al filtrar el feed | Fail closed: lista vacía / evento no encontrado (nunca se filtra por un conjunto vacío en falso). |
| `audience_type` nulo o desconocido en el mirror | Nulo → `'all'`; desconocido → fail closed (`false`). |
| `audience_workgroup = 'ninguno'` (dato corrupto) | El mirror lo rechaza explícitamente: nunca se filtra a "todos". |
| Grupo legacy + audiencia (evento `work_shift` con `visible_to_group`) | Intersección: ambas reglas deben pasar (mismo comportamiento de Sprint 12 para `'all'`). |
| Miembro navega directo a la URL de un evento de audiencia ajena | `getEventById` devuelve `null` → 404 (RLS + mirror). |
| Creador (no-management) leyendo la audiencia de su evento | Permitido por la rama "creator" de las policies de `event_audience_users` (D4/D5). |
| Selector con tipo `work_shift` en el formulario (management) | Sección visible pero deshabilitada con nota "Los eventos de trabajo solo se muestran a su grupo de trabajo." |

---

## Consecuencias

### Positivas

- Segmentación completa: todos / grupo / tipo de miembro / usuarios concretos, con UI de
  selección con búsqueda.
- Feed (lista, calendario, dashboard, widget) y detalle filtrados por audiencia con mirror puro
  unit-testable.
- Editor rápido en el detalle (management/creador) con `updateEventAudienceAction`; revalidación
  de rutas correcta.
- Defensa en profundidad: Zod + `resolveAudienceFields` + RLS (espejos alineados, tests por
  capa).
- Compatibilidad total con eventos pre-Sprint 18 (default `'all'`) y con `work_shift` de
  Sprint 12 (regla de grupo intacta, policies de escritura intactas).
- Suite completa: **710 tests en 48 archivos pasando** (57 nuevos), `tsc --noEmit` y
  `eslint . --max-warnings=0` limpios (verificados en local).

### Seguridad (defensa en profundidad)

- Autorización de `updateEventAudience` en servidor (management o creador; nunca confiar solo en
  RLS).
- RLS de `event_audience_users`: propia fila / management / creador — la cláusula own-row es la
  pieza que permite el feed vía cliente autenticado sin abrir datos ajenos (solo `event_id` de
  filas propias).
- Fail closed en todos los caminos de visibilidad del servidor (getUser fallido, tipo de
  audiencia desconocido, `'ninguno'` corrupto).
- Sin grants `service_role` nuevos (el REPLACE usa el cliente autenticado del actor autorizado).

### Riesgos / pendientes

- **Verificación SQL manual pendiente** (no hay entorno Supabase local ni CLI): la migración
  0050 y la policy de eventos deben ejecutarse contra una BD real antes del merge. Ver
  [checklist](#revisión-sql-manual-pendiente).
- `docs/DATABASE.md` no se actualiza en este sprint (sigue el patrón de Sprints 17/17b, cuyas
  migraciones 0044–0048 tampoco están en la tabla de migraciones); actualización opcional en un
  chore posterior.
- **Gaps conocidos de compensación (LOW risk, documentados, sin endurecer en este sprint)**:
  - `updateEventAudience` (y `updateEvent`) escriben primero las columnas `audience_*` y después
    reemplazan las filas de `event_audience_users`; si el reemplazo falla no hay compensación
    hacia atrás (el evento queda con la nueva `audience_type` pero con filas antiguas/ausentes).
    El error sí se devuelve al cliente, así que la inconsistencia solo persiste si el usuario
    ignora el mensaje; el editor rápido hace `router.refresh()` y reflejaría el estado real.
  - En `createEvent`, el borrado de compensación del evento recién creado es **best-effort**: no
    se comprueba el error del propio `delete`, de modo que si ese delete fallara podría
    sobrevivir un evento a medio configurar (sin filas de audiencia). Ambos requieren un fallo
    transitorio de red/BD en una ventana mínima; endurecimiento futuro: envolver columnas + filas
    en una transacción atómica.
- `tasks/sprint-18-event-audience.json` y `tasks/plan-desarrollo-completo.md` no se tocan en los
  commits (los gestiona el orquestador).
- Sin PR todavía: commits en `feature/sprint-18-event-audience` siguiendo `docs/git-conventions.md`;
  el PR y el escaneo security-champion los gestiona el pipeline estándar.

---

## Revisión SQL manual (pendiente)

No hay Docker/Supabase local disponible en el entorno de implementación; el SQL es
hand-reasoned. Checklist para la verificación manual antes del deploy:

- [ ] `do $$ … create type umsuka.audience_type … exception when duplicate_object` — re-ejecución
      idempotente.
- [ ] `alter table umsuka.events add column if not exists audience_type … not null default 'all'` —
      filas legacy quedan en `'all'`.
- [ ] Los 4 CHECK constraints aplican y rechazan: `audience_workgroup` con tipo ≠ `workgroup`;
      `audience_member_type` con tipo ≠ `member_type`; valores fuera de whitelist.
- [ ] `umsuka.current_user_component()` devuelve el componente del usuario autenticado (y `null`
      sin sesión) y el grant a `authenticated` permite su ejecución desde la policy.
- [ ] `event_audience_users`: PK compuesta, FKs con `on delete cascade`, RLS `enabled` +
      `forced`.
- [ ] SELECT de `event_audience_users` con un miembro devuelve solo sus propias filas; con
      management/creador, todas/la del evento.
- [ ] INSERT/UPDATE/DELETE de `event_audience_users` denegados para un miembro no-autorizado.
- [ ] `events_select_authenticated` reemplazada correctamente (la antigua queda descartada con
      `drop policy if exists`); un miembro de grupo ve su `work_shift`; management ve todo; un
      usuario de audiencia `specific_users` ve el evento solo si está en la tabla; intersección
      grupo-AND-audiencia para eventos con ambas restricciones.
- [ ] Las policies de escritura de eventos (lead/management, Sprint 12) siguen vigentes y sin
      cambios.
- [ ] `supabase db push` aplica la migración 0050 sin errores (o `npm run supabase:reset` en
      local).

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101005000_event_audience.sql` | CREATE — enum `audience_type`, columnas `audience_*`, CHECKs, índices, `current_user_component()`, tabla `event_audience_users` + RLS, reescritura de `events_select_authenticated` |
| `src/types/database.types.ts` | MODIFY — `AudienceType`, columnas en `events` (Row/Insert/Update), tabla `event_audience_users` (Relationships: []), `current_user_component` en Functions, `audience_type` en Enums |
| `src/lib/events/audience-shared.ts` | CREATE — capa **client-safe** (isomórfica): constantes/etiquetas, `AUDIENCE_TYPES`, `AUDIENCE_MEMBER_TYPES`, `AUDIENCE_WORKGROUPS`, `AUDIENCE_FORM_FIELDS`, `audienceCrossFieldIssueFn`, `audienceSchema`, `updateEventAudienceSchema`, `isEventVisibleToAudience`, `getAudienceSummary` |
| `src/lib/events/audience.ts` | MODIFY — parte **servidor** (supabase/auth): `resolveAudienceFields`, `replaceAudienceUsers`, queries (`getMyAudienceEventIds`, `getEventAudienceUsers`, `getAudienceOptions`, `getAudienceUserCounts`, `getEventAudience`), `updateEventAudience`; `export *` de `audience-shared` |
| `src/lib/events/schema.ts` | MODIFY — spread `AUDIENCE_FORM_FIELDS` + `superRefine` en los tres schemas de evento |
| `src/lib/events/queries.ts` | MODIFY — `audienceType`/`audienceWorkgroup`/`audienceMemberType` en `EventListItem`/`EventRow`/`EVENT_SELECT`/`mapRow`; `EventVisibility.componentType` (requerido); filtro no-management con `isEventVisibleToAudience` + fail closed; `getVisibleEvents` |
| `src/lib/events/mutations.ts` | MODIFY — `createEvent`/`updateEvent` con resolución e inserción de audiencia, compensación, sync de filas; `createEventWithAudience` (alias documentado) |
| `src/app/events/audience-actions.ts` | CREATE — `createEventWithAudienceAction`, `updateEventAudienceAction`, `getVisibleEventsAction` |
| `src/app/events/audience-selector.tsx` | CREATE — sección "¿A quién se muestra?" (selectores condicionales + multi-select con búsqueda) |
| `src/app/events/[id]/audience-editor.tsx` | CREATE — editor rápido colapsado (management/creador; nota estática para `work_shift`) |
| `src/app/events/event-form.tsx` | MODIFY — props `audienceMembers`/`selectedAudienceUsers`/`canConfigureAudience`; create → `createEventWithAudienceAction` |
| `src/app/events/new/page.tsx` | MODIFY — `defaultValues` de audiencia; `getAudienceOptions()`; `canConfigureAudience = isManagement` |
| `src/app/events/page.tsx` | MODIFY — `componentType` en la visibilidad; badge de audiencia (management/creador) con conteos batcheados |
| `src/app/events/[id]/page.tsx` | MODIFY — `componentType` en `getEventById`; badge de audiencia; `AudienceEditor`; `defaultValues` de audiencia en el formulario de edición |
| `src/app/calendar/page.tsx` | MODIFY — `componentType` en la visibilidad de `listEvents` |
| `src/app/dashboard/page.tsx` | MODIFY — `componentType` en la visibilidad de `listEvents` |
| `tests/unit/lib/events-audience-schema.test.ts` | CREATE — 24 tests de schemas |
| `tests/unit/lib/events-audience-visibility.test.ts` | CREATE — 13 tests del mirror de visibilidad |
| `tests/unit/lib/events-audience-mutations.test.ts` | CREATE — 20 tests de mutaciones (mock scripted, patrón `events-policy.test.ts`) |
| `docs/adr-sprint-18-event-audience.md` | CREATE — este ADR |

### Tests

| Archivo | Tests |
|---|---|
| `tests/unit/lib/events-audience-schema.test.ts` (CREATE) | 24 — defaults, normalización `''`→null, validación cruzada por tipo, rechazos (`ninguno`/inválido/UUID), schemas de evento con defaults, `updateEventAudienceSchema` |
| `tests/unit/lib/events-audience-visibility.test.ts` (CREATE) | 13 — matriz all/workgroup/member_type/specific_users, management, intersección grupo-AND-audiencia, null→all, `'ninguno'` nunca matchea, fail-closed desconocido |
| `tests/unit/lib/events-audience-mutations.test.ts` (CREATE) | 20 — create por tipo, filas insertadas, compensación, work_shift forzado/rechazado, update (replace/delete/forced-all), `updateEventAudience` (authz, work_shift, reemplazo) |

**Total de la suite: 710 tests en 48 archivos, todos pasando** (`npx vitest run`).
`npx tsc --noEmit`, `npx eslint . --max-warnings=0` y `npm run build` (producción) limpios en
local tras la división de módulos client-safe (el build de producción fallaba antes del split con
"You're importing a component that needs next/headers" por la cadena
`audience.ts → supabase/server.ts → next/headers`).
