# Fix: recursión infinita RLS en políticas de events

**Status:** Accepted (Implementado) · **Date:** 2026-08-19 · **Tipo:** Fix de
producción · **Branch:** `fix/events-rls-infinite-recursion` · **Migración:**
`20260101005500`

---

## Contexto

El dashboard de producción (`/dashboard`) fallaba al cargar la lista de eventos
con el error:

```
Failed to list events: infinite recursion detected in policy for relation "events"
```

### Cadena causal exacta

El origen del bug es la migración `20260101005000` (Sprint 18, segmentación de
audiencia de eventos; ver ADR-018), que introdujo una **recursión mutua** entre
las políticas RLS de dos tablas:

1. **`events_select_authenticated`** (0050, sección 8) consulta
   `umsuka.event_audience_users` con un `exists` inline para resolver la
   audiencia `specific_users`:

   ```sql
   exists (
     select 1 from umsuka.event_audience_users eau
     where eau.event_id = umsuka.events.id
       and eau.user_id = auth.uid()
   )
   ```

2. **Las 4 políticas de `umsuka.event_audience_users`** (0050, sección 7:
   SELECT/INSERT/UPDATE/DELETE) consultan `umsuka.events` con un `exists`
   inline para resolver "¿es el llamador el creador del evento?":

   ```sql
   exists (
     select 1 from umsuka.events e
     where e.id = event_id
       and e.created_by = auth.uid()
   )
   ```

3. **Ambas tablas están bajo `FORCE RLS`**: `umsuka.events` desde la migración
   0013 y `umsuka.event_audience_users` desde la 0050. `FORCE RLS` aplica las
   políticas incluso al propietario de la tabla, de modo que **toda** subconsulta
   sobre la tabla dispara la evaluación de sus políticas.

Resultado: al evaluar `events_select_authenticated` para un usuario
**no-management** sobre un evento con `audience_type != 'all'`, el OR de la
política llega a la rama del `exists` sobre `event_audience_users`; evaluar esa
subconsulta re-entra en las políticas de `event_audience_users` (por FORCE RLS),
cuyo `exists` sobre `events` re-entra en `events_select_authenticated`, y así
sucesivamente. PostgreSQL aborta la evaluación con `infinite recursion detected
in policy for relation "events"`. Los usuarios management no lo sufrían porque
`umsuka.is_management()` (primer término del OR, SECURITY DEFINER que no
re-entra en RLS) resuelve el predicado sin llegar a las ramas de los `exists`.

Criterios de aceptación del task (`tasks/fix-events-rls-infinite-recursion.json`):
el SELECT de un usuario autenticado no-management sobre `umsuka.events` no debe
producir el error, la visibilidad por audiencia (`all` / `workgroup` /
`member_type` / `specific_users`) debe conservarse exactamente igual, la
semántica de `event_audience_users` (own row / management / creador) debe
preservarse, y el fix debe ser puramente SQL (cero cambios de tipos TS o de la
capa de aplicación).

---

## Decisión

### D1 — Extraer ambas subconsultas a funciones SECURITY DEFINER

El fix sigue el **patrón canónico del repositorio** (funciones helper de las
migraciones 0013/0019/0050, que son SECURITY DEFINER precisamente "to avoid
recursive RLS lookups"): se extrae **cada** subconsulta recursiva a una función
propia, rompiendo la cadena en ambos arcos.

**`umsuka.is_event_creator(p_event_id uuid)`** — responde "¿el llamador creó
este evento?" (sustituye los 4 `exists` inline sobre `umsuka.events` de las
políticas de `event_audience_users`):

```sql
create or replace function umsuka.is_event_creator(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select exists(
    select 1 from umsuka.events e
    where e.id = p_event_id
      and e.created_by = auth.uid()
  );
$$;

comment on function umsuka.is_event_creator(uuid) is
  'Returns true if the currently authenticated user created the given event. SECURITY DEFINER so RLS policies can call it without re-entering the policy machinery (breaks the events <-> event_audience_users recursion fixed in migration 0055).';

grant execute on function umsuka.is_event_creator(uuid) to authenticated;
```

**`umsuka.is_event_audience_member(p_event_id uuid)`** — responde "¿el llamador
forma parte de la audiencia concreta de este evento?" (sustituye el `exists`
inline sobre `umsuka.event_audience_users` de `events_select_authenticated`):

```sql
create or replace function umsuka.is_event_audience_member(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select exists(
    select 1 from umsuka.event_audience_users eau
    where eau.event_id = p_event_id
      and eau.user_id = auth.uid()
  );
$$;

comment on function umsuka.is_event_audience_member(uuid) is
  'Returns true if the currently authenticated user belongs to the concrete audience (umsuka.event_audience_users) of the given event. SECURITY DEFINER so RLS policies can call it without re-entering the policy machinery (breaks the events <-> event_audience_users recursion fixed in migration 0055).';

grant execute on function umsuka.is_event_audience_member(uuid) to authenticated;
```

**Mecánica por la que rompe la recursión:** la función se ejecuta con los
privilegios de su dueño (el rol de migración, `postgres`, superusuario), por lo
que sus consultas **bypasean RLS** — incluso con `FORCE RLS` en las tablas — y
no re-entran en la maquinaria de políticas. El predicado `auth.uid()` sigue
resolviendo al llamador de la política (el `uid` se toma de la sesión JWT
actual), así que la semántica de autorización no cambia: solo cambia **quién**
ejecuta el `exists`. Cada arco de la recursión mutua queda reemplazado por una
llamada a una función que no dispara RLS, y la cadena se corta en ambos
extremos.

Atributos del patrón canónico, idénticos a `is_management()` (0013) y
`current_user_workgroup()` (0019): `language sql`, `stable`, `security definer`,
`set search_path = umsuka, public` (schema-qualified, hardening contra
hijacking de search_path), `comment` explicativo y `grant execute to
authenticated`.

### D2 — Reescritura de las 5 políticas con equivalencia lógica 1:1

Se dropean y recrean 5 políticas (1 de `events` + 4 de `event_audience_users`)
sustituyendo **únicamente** las subconsultas inline por las llamadas a las
funciones; las condiciones, el orden de los operadores y la lógica son
exactamente los de la migración 0050:

| Política | Tabla | Antes (0050) | Después (0055) |
|---|---|---|---|
| `events_select_authenticated` | `umsuka.events` | `exists (... from umsuka.event_audience_users ...)` | `umsuka.is_event_audience_member(umsuka.events.id)` |
| `event_audience_users_select_own_or_management_or_creator` | `umsuka.event_audience_users` | `exists (... from umsuka.events ...)` | `umsuka.is_event_creator(event_id)` |
| `event_audience_users_insert_management_or_creator` | `umsuka.event_audience_users` | `exists (... from umsuka.events ...)` | `umsuka.is_event_creator(event_id)` |
| `event_audience_users_update_management_or_creator` | `umsuka.event_audience_users` | `exists (... from umsuka.events ...)` | `umsuka.is_event_creator(event_id)` |
| `event_audience_users_delete_management_or_creator` | `umsuka.event_audience_users` | `exists (... from umsuka.events ...)` | `umsuka.is_event_creator(event_id)` |

La equivalencia línea por línea entre las políticas originales (0050, secciones
7 y 8) y las reescritas (0055, secciones 3 y 4) fue verificada por el QA: mismas
condiciones, mismo ordenamiento, mismos operadores; el único cambio es la
sustitución de la subconsulta correlacionada inline por la llamada a la función
SECURITY DEFINER. La visibilidad por audiencia (`all` / `workgroup` /
`member_type` / `specific_users`) y la semántica de `event_audience_users` (own
row, management, o creador del evento) se conservan intactas.

### D3 — Idempotencia y supercesión (patrón del repo)

- `create or replace function` + `drop policy if exists` previo a cada
  `create policy`: re-ejecutar la migración es un no-op limpio.
- Las políticas originales de la 0050 **no se modifican**: la 0055 las
  supersede en el deploy (patrón de migración del repositorio).
- La migración incluye un checklist manual de verificación pre-deploy (no hay
  entorno Supabase local/CLI en el entorno de implementación; el SQL es
  hand-reasoned, patrón de los sprints previos).

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| (a) Quitar los `exists` de las políticas (simplificar a visibilidad por `visible_to_group` + audiencia `all`/`workgroup`/`member_type`) | Rompe el contrato de visibilidad de la 0050/ADR-018: los eventos `specific_users` quedarían invisibles para su audiencia y el creador/management no podrían leer la configuración de audiencia a través del cliente autenticado. |
| (b) Quitar `FORCE RLS` de `event_audience_users` | Debilita la seguridad del feed mirror (lectura de "¿en qué eventos estoy?" vía cliente autenticado): el RLS pasaría a depender del propietario y se perdería la defensa en profundidad que `FORCE RLS` da sobre la escritura service-role y sobre el propio `exists` recíproco. Además, el arco events→event_audience_users seguiría re-entrando en RLS. |
| (c) Unificar en una sola política comodín (p. ej. una única política `FOR ALL` por tabla) | No resuelve la recursión: el problema es la **re-entrada mutua entre tablas** (events → event_audience_users → events), no la cantidad ni el tipo de políticas. Cualquier política de `event_audience_users` que consulte `events`, y cualquier política de `events` que consulte `event_audience_users`, bajo FORCE RLS en ambas, reproduce la recursión. |

---

## Consecuencias

### Positivas

- **Dashboard operativo**: el SELECT a `umsuka.events` desde el cliente
  autenticado ya no produce `infinite recursion detected in policy for relation
  "events"` para usuarios no-management.
- **Visibilidad intacta**: contrato de la 0050 preservado para los cuatro
  `audience_type` (`all` / `workgroup` / `member_type` / `specific_users`) y
  para la semántica de `event_audience_users` (own row / management / creador).
- **Fix puramente SQL**: sin cambios de esquema, sin cambios en
  `src/types/database.types.ts`, sin cambios en la capa de aplicación ni en la
  suite de tests (no se espera ningún delta TS).
- **Idempotente**: `create or replace function` + `drop policy if exists`
  permiten re-ejecutar la 0055 sin efecto.
- **Patrón consolidado**: refuerza el patrón SECURITY DEFINER del repo (0013/
  0019/0050) como la forma canónica de evitar lookups recursivos de RLS.

### Riesgos / pendientes

- **Smoke test post-deploy obligatorio** (no hay entorno Supabase local; el SQL
  es hand-reasoned). Según el checklist de la propia 0055, verificar antes y
  después del deploy:
  - `supabase db push` aplica la migración; re-ejecutarla es idempotente.
  - Un SELECT de un usuario **no-management** sobre un evento con
    `audience_type = 'specific_users'` no lanza el error de recursión y devuelve
    las filas esperadas (mismas que antes de la 0055 para los cuatro tipos de
    audiencia).
  - Las dos funciones existen con `language sql` / `stable` / `security
    definer` / `set search_path = umsuka, public` y grant a `authenticated`;
    no queda ningún `exists (... from umsuka.events ...)` en políticas de
    `event_audience_users` ni `exists (... from umsuka.event_audience_users ...)`
    en `events_select_authenticated`; cada política reescrita existe una sola
    vez.
  - El creador del evento puede insertar/actualizar/borrar filas de
    `event_audience_users` de sus propios eventos; management, de cualquiera; un
    miembro regular solo ve sus propias filas (visibilidad de
    `events`/`event_audience_users`).

---

## Archivos

| Archivo | Acción |
|---------|--------|
| `supabase/migrations/20260101005500_fix_events_rls_recursion.sql` | CREATE — 2 funciones SECURITY DEFINER (`is_event_creator(uuid)`, `is_event_audience_member(uuid)`) con el patrón canónico (language sql, stable, security definer, search_path fijo, grant a authenticated); 5 políticas reescritas (1 de `events` + 4 de `event_audience_users`) con equivalencia 1:1 sobre la 0050; checklist manual pre-deploy |

---

## Estado

- Fix implementado en la migración 0055 (working tree, rama
  `fix/events-rls-infinite-recursion`, aún no pusheada).
- Sin cambios TS ni de aplicación: suite de tests, `tsc --noEmit` y lint sin
  deltas esperados; security scan sin issues HIGH.
- QA: código aprobado (equivalencia de las 5 políticas verificada línea por
  línea); este ADR era el ítem de completitud pendiente del DoD del task
  `tasks/fix-events-rls-infinite-recursion.json` y se cierra con este documento.

---

## Referencias

- Migración origen del bug: `supabase/migrations/20260101005000_event_audience.sql`
  (Sprint 18 — sección 7: RLS de `event_audience_users` con `exists` sobre
  `events` y FORCE RLS; sección 8: `events_select_authenticated` con `exists`
  sobre `event_audience_users`).
- Patrón SECURITY DEFINER: `supabase/migrations/20260101001300_rls_policies.sql`
  (`is_management()`, `is_admin()`, `current_user_role()` — "SECURITY DEFINER
  to avoid recursive RLS lookups" y FORCE RLS de `events`) y
  `supabase/migrations/20260101001900_workgroup_rls.sql`
  (`current_user_workgroup()`, mismo patrón, usado por la política reescrita).
- Task file: `tasks/fix-events-rls-infinite-recursion.json` (criterios de
  aceptación, DoD — incluye el ADR como entregable; el ADR fue marcado como
  pendiente por el QA en la fase de documentación y se cierra con este
  documento).
- ADR-018 (Sprint 18 — Event Audience): decisiones de diseño de la 0050 cuyo
  contrato de visibilidad este fix preserva.
- PR del fix: posterior al cierre de este ADR (los cambios viven en el working
  tree; convenciones de rama/commits/PR en `docs/git-conventions.md`, §3.3
  regla 5: ADR obligatorio).
- ADR-011 (fix de producción): patrón de este documento (Contexto / Decisión /
  Alternativas / Consecuencias / Archivos).
