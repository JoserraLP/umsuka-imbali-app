# ADR-019: Sprint 19 — Perfiles y Componentes (Enriched Profiles)

**Status:** Accepted · **Date:** 2026-08-17

---

## Context

Hasta el Sprint 18, `umsuka.profiles` contenía únicamente los campos clásicos: nombres,
`birth_date`, `component_type`, `workgroup`, `role`, `is_active`, `status`, `username`,
`auth_method`, flags de responsabilidad y `created_at` (fecha de alta de la cuenta, usada en el
listado de miembros desde el Sprint 14). La tabla acumula 52 archivos de migración
(0000–0051, 26 de ellos modificando `umsuka.profiles`); la RLS está formada por
`profiles_update_own_or_admin` (migración 0013, UPDATE propia o de admin/super_admin) y
`profiles_select_authenticated` (migración 0027, SELECT para cualquier miembro activo), ambas
**agnósticas a columnas**.

La página `/profile` mostraba tres tarjetas: "Datos personales" (formulario clásico), "Mi grupo
de trabajo" (`WorkgroupSection`) y "Contraseña" (solo cuentas `email_alias`). No existía foto,
biografía, teléfono, habilidades ni fecha de incorporación, y el perfil carecía de cualquier
resumen de participación (los históricos vivían en páginas separadas: `/profile/history` y
`/profile/shifts`).

Se requería (criterios de aceptación del task file):

- Cada miembro tiene un perfil con foto, biografía y habilidades.
- Los miembros pueden editar su propio perfil (foto, bio, teléfono, habilidades) desde `/profile`.
- La página de perfil muestra el historial de eventos, turnos y asistencia del miembro.
- El formulario valida los nuevos campos con mensajes claros **en español**.
- Un miembro no puede editar los campos de otro miembro (autorización y RLS intactas).

### Restricciones heredadas

- No hay entorno Supabase local ni CLI disponible en el entorno de implementación: el SQL es
  hand-reasoned y queda **pendiente de verificación manual** (checklist en
  [Revisión SQL manual](#revisión-sql-manual-pendiente)); `src/types/database.types.ts` se edita
  a mano (nunca se regenera con el CLI), patrón de todos los sprints.
- La política `profiles_select_authenticated` permite a **cualquier miembro activo** leer
  columnas de `profiles`: toda proyección que devuelva datos de contacto queda expuesta por API,
  lo que condiciona el diseño del listado (ver D6).
- No existe Supabase Storage en el repo (ni buckets ni políticas): los avatares solo pueden ser
  URLs externas, y la CSP/`remotePatterns` de next/image ya contempla hosts externos concretos
  (Google, Supabase, Unsplash) — se **reutiliza** esa allowlist, sin tocar `next.config.ts`.
- Las server actions `updateOwnProfileAction` (`src/app/profile/actions.ts`) y
  `updateMemberProfileAction` (`src/app/admin/users/actions.ts`) ya existen y reenvían el input
  al resolver de `src/lib/profiles/`: no requieren cambios, la ampliación vive en el schema.

---

## Decisión

### D1 — `joined_at`: fecha de incorporación a la comparsa (semántica distinta de `created_at`)

`joined_at` (`date`, nullable) se **mantiene** y documenta como "fecha de incorporación a la
comparsa": es un dato biográfico **editable por el propio miembro** ("En la comparsa desde:
…" en la cabecera del perfil), mientras que `created_at` es la fecha de alta de la cuenta
(Sprint 14), **solo lectura** ("Alta de cuenta: …"). La diferencia de semántica queda
registrada en un `comment on column` de la migración:

```sql
alter table umsuka.profiles
  add column if not exists joined_at date;

alter table umsuka.profiles
  add constraint chk_profiles_joined_at_not_future
  check (joined_at is null or joined_at <= current_date);

comment on column umsuka.profiles.joined_at is
  'Date the member joined the comparsa, editable by the member themselves. Distinct from created_at (account creation timestamp, read-only). null when unset.';
```

Defensa en profundidad en la capa de aplicación: `updateOwnProfileSchema.joinedAt` valida que sea
una fecha parseable y **no futura** ("La fecha de incorporación no puede ser futura."), con
coerción de cadena vacía → `null`. La BD vuelve a rechazar cualquier fecha futura con el CHECK.

### D2 — `avatar_url`: URL externa HTTPS con allowlist de hosts (espejo de la CSP), sin Supabase Storage

El avatar es una **URL externa** validada contra una allowlist que espeja la CSP/`remotePatterns`
de la app (`AVATAR_ALLOWED_HOSTS` en `src/lib/profiles/schema.ts`), de modo que toda URL que
pase la validación es renderizable por `next/image` **sin tocar `next.config.ts` ni la CSP**:

| Host | Regla |
|---|---|
| `lh3.googleusercontent.com` | exacto (avatares de Google OAuth) |
| `*.supabase.co` (wildcard) | `host === "supabase.co"` **o** `host.endsWith(".supabase.co")` — como sufijo de dominio: `evilsupabase.co` → rechazado, `supabase.co.evil.com` → rechazado |
| `images.unsplash.com` | exacto (fotos de Unsplash) |

`isAllowedAvatarUrl(value)` exige además protocolo `https:` y URL parseable (fail closed ante
cualquier valor malformado). El CHECK de BD es deliberadamente **más débil** (defensa en
profundidad: la allowlist vive en la capa de aplicación):

```sql
chk_profiles_avatar_url_length: avatar_url is null or length(avatar_url) <= 2048
chk_profiles_avatar_url_https:  avatar_url is null or avatar_url ~ '^https://'
```

**Sin Supabase Storage**: el repo no tiene buckets, políticas de storage ni signed URLs; la
subida de avatares queda documentada como **mejora futura** (cuando exista storage, la allowlist
ya contempla `*.supabase.co` y el pipeline migrará sin tocar la UI).

**Fallback en cascada** (en `buildAuthenticatedProfile`, `src/lib/auth/session.ts`):

1. `profiles.avatar_url` (fuente de verdad, validada por Zod al escribirse).
2. `user_metadata.avatar_url` del proveedor OAuth — **solo si** pasa `isAllowedAvatarUrl`
   (fix de security-champion, L2: nunca confiar en metadata ajena; ver alternativa (f)).
3. Si ninguno es válido → **iniciales** (`Avatar` con `fallback`, componente existente
   `src/components/feed/avatar`).

### D3 — `skills` text[] con validación en dos capas + UI de chips

`skills text[] NOT NULL default '{}'` en BD, con `chk_profiles_skills_count`
(`array_length(skills, 1) <= 10`). En la capa de aplicación, `normalizeSkills` (helper **puro**
en `schema.ts`) aplica: trim por ítem, descarte de vacíos, **dedupe case-insensitive** (gana la
primera ocurrencia, p. ej. `["Baile", "baile"]` → `["Baile"]`) y tope de 10 ítems. El campo Zod
impone además 1–50 caracteres por ítem ("Cada habilidad debe tener 50 caracteres o menos.") y
máximo 10 ("Máximo 10 habilidades."), con `default([])`.

- **UI**: `SkillsInput` (`src/app/profile/skills-input.tsx`, CREATE, cliente) — chips con
  `Badge` + botón de eliminar (no existe componente chips en `src/components/ui/*`; se reutilizan
  `Badge`/`Input`), añadir con Enter o coma, `maxLength={50}` en el input (espejo del límite por
  ítem) y deshabilitado al llegar a 10. `getSkillsErrorMessages` extrae de react-hook-form los
  mensajes **raíz** ("Máximo 10 habilidades.") y **por ítem** (eras indexadas), garantizando
  feedback visible en un submit bloqueado.
- El componente se reutiliza en el formulario admin (ver D7).

### D4 — Historial como resumen de conteos en `/profile` (sin embeber tablas)

Nueva tarjeta **"Historial"** en `/profile` con **5 tiles de conteo**, cada uno enlazando a su
página existente:

| Tile | Fuente (count-only) | Enlace |
|---|---|---|
| Eventos apuntados | `event_registrations` (`user_id`) | `/events` |
| Asistencias | `attendance` (`user_id` + `attended = true`) | `/profile/history` |
| Faltas sin asistir | `attendance` (`user_id` + `attended = false`) | `/profile/history` |
| Ausencias | `absences` (`user_id`) | `/profile/history` |
| Turnos | `shift_assignments` (`user_id`) | `/profile/shifts` |

`getProfileHistorySummary(userId)` (`src/lib/profiles/queries.ts`) ejecuta **cinco queries
count-only** (`select("*", { count: "exact", head: true })`) en **`Promise.all`**, cada una
**scoped al `user_id` propio**, y devuelve `ProfileHistorySummary`. Si una query falla, lanza un
error que **identifica la tabla** ("Failed to fetch absences count for user …"). Las tablas de
detalle **no se embeber** en `/profile`: ya existen en `/profile/history` y `/profile/shifts` y
embeberlas duplicaría queries y contenido (ver alternativa (c)).

### D5 — RLS sin cambios: políticas existentes agnósticas a columnas + autorización en aplicación

Las políticas **no se tocan**:

- `profiles_update_own_or_admin` (migración 0013) cubre el UPDATE de las columnas nuevas
  (own row para miembros, cualquier fila para admin/super_admin): la migración 0051 añade solo
  columnas + CHECKs + comentarios, sin `create policy`.
- `profiles_select_authenticated` (migración 0027) cubre el SELECT de cualquier columna.

La autorización real vive en la capa de aplicación (patrón del repo, nunca confiar solo en RLS):

- **Own**: `updateOwnProfile` → `requireAuthenticatedProfile()` + `.update(...).eq("id",
  profile.id)` — el actor solo puede escribir su propia fila.
- **Admin**: `updateMemberProfile` → `requireAuthenticatedProfile()` + `requireAdmin()` +
  `.eq("id", parsed.data.userId)`.

### D6 — Fix de security-champion (MEDIUM): least privilege en la proyección de perfiles

La política `profiles_select_authenticated` permite a **cualquier miembro activo** leer perfiles
a través de la API. El listado `/admin/users` se sirve con esa misma política (sin cliente
elevado), así que **todo lo que proyecte `listProfiles` queda legible por todos los miembros**.
Para no exponer PII de contacto (teléfono, bio, foto) innecesariamente:

| Tipo | Campos de contacto | Uso |
|---|---|---|
| `ProfileListItem` / `listProfiles` | **SIN** `phone` / `bio` / `avatarUrl` (contact-free) | listado del directorio `/admin/users` |
| `ProfileDetail` / `getProfileById` | **CON** `phone` / `bio` / `avatarUrl` / `skills` / `joinedAt` | detalle de miembro (admin) y perfil propio vía `getCurrentProfile` |

`ProfileDetail` lleva un JSDoc `SECURITY` indicando que la proyección incluye datos de contacto
privados y **solo debe exponerse a management o al propio miembro**; los call sites actuales ya
están gateados por rol ([id]/page.tsx con `isAdminRole`) o por sesión (own profile). El listado
sí incluye `skills` y `joinedAt` (no son datos de contacto sensibles y alimentan la UI del
directorio).

### D7 — `updateMemberProfileSchema` hereda los campos nuevos (admin edita también lo personal)

`updateMemberProfileSchema` se define como `updateOwnProfileSchema.extend({ userId, workgroup })`:
el admin edita los **mismos campos personales enriquecidos** que el miembro (avatar, bio, phone,
skills, joinedAt, fechas, componente) vía `member-edit-form.tsx` ampliado (payload idéntico al
own form + workgroup + userId oculto). `role` sigue excluido de ambos (solo
`updateMemberRoleSchema`+`updateMemberRoleAction`, con `requireAdmin` + `canAssignRole`).

Fixtures de tests actualizados: los mocks de `AuthenticatedProfile` en
`votings-mutations.test.ts`, `admin-set-component-lead.test.ts` y
`events-audience-mutations.test.ts` ganan `bio: null`, `phone: null`, `skills: []`,
`joinedAt: null` — obligatorio porque `AuthenticatedProfile` incluye los campos como **requeridos**
(`src/types/auth.ts`).

### Server actions

Sin cambios en `src/app/profile/actions.ts` ni `src/app/admin/users/actions.ts`: ambas reenvían
el input ya parseado a los resolvers de `src/lib/profiles/`, que aplican los schemas ampliados.
`updateOwnProfileAction` mantiene su `revalidatePath("/profile")` (+ `/dashboard`).

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| (a) Supabase Storage para los avatares (subida de archivos, bucket, políticas, signed URLs) | Scope nuevo completo (bucket, políticas de storage, URLs firmadas, componente de subida); el repo no usa storage en absoluto; la allowlist de la CSP ya existe y permite hosts externos. Se documenta como mejora futura (D2), sin deuda acumulada. |
| (b) Descartar `joined_at` por redundancia con `created_at` | Semántica distinta: incorporación a la comparsa (editable por el miembro) vs alta de cuenta (solo lectura, Sprint 14). Eliminarlo privaría al perfil de un dato biográfico que consta por separado en la realidad de la comparsa (D1). |
| (c) Embeber las tablas de historial en `/profile` | Duplicaría queries y contenido: `/profile/history` y `/profile/shifts` ya existen; `getProfileHistorySummary` con 5 counts `head:true` es barato y suficiente para los tiles (D4). |
| (d) Permitir cualquier URL `https` como avatar | Rompería la CSP/`remotePatterns` o exigiría debilitarlos (wildcard abierto → vectores de SSRF/abuso de ancho de banda de `next/image`). La allowlist espejo exige tocar la app y la config juntas (D2). |
| (e) Mensajes de validación en inglés para los campos nuevos | El criterio de aceptación exige mensajes claros en español; los campos nuevos usan mensajes en español mientras los clásicos conservan los suyos (mejora gradual sin tocar textos existentes). |
| (f) Confiar en el `avatar_url` de la metadata OAuth sin validarlo | La metadata puede estar manipulada o apuntar a un host no permitido; el fix L2 de security-champion valida también el fallback con `isAllowedAvatarUrl` (defensa en profundidad, fail closed a iniciales) en lugar de asumir que Google solo emite URLs de `lh3.googleusercontent.com` (D2). |

---

## Edge cases manejados

| Escenario | Comportamiento |
|---|---|
| Skills con solo espacios o vacías tras el trim | `normalizeSkills` descarta los ítems vacíos → `[]`; input sin chips muestra "Sin habilidades todavía…" |
| Skill de más de 50 caracteres | `maxLength={50}` en el `Input` (previo) + Zod por ítem + `getSkillsErrorMessages` muestra el error del ítem concreto en la UI |
| Skills duplicadas con distinto case (`Baile`/`baile`) | Dedupe case-insensitive: gana la primera ocurrencia, se conserva su capitalización |
| Teléfono con `+` en cualquier posición | Regex permisivo `^[+0-9 ()-]{6,20}$` (espejo exacto del CHECK de BD): valida `+34 600…`, `(34)`, guiones; rechaza letras y longitudes fuera de rango |
| `avatar_url` de host no permitido, `http://` o malformado | Rechazo en Zod con mensaje en español ("…debe ser HTTPS y estar alojada en un dominio permitido (Google, Supabase o Unsplash)."); la BD solo exige `https://` + longitud (backstop) |
| `joined_at` futura o no parseable | Rechazo en Zod ("La fecha de incorporación no puede ser futura." / fecha válida) + CHECK `chk_profiles_joined_at_not_future` en BD |
| Perfil legacy con `joined_at` null | La línea "En la comparsa desde" no se renderiza (sin dato); el formulario muestra el campo vacío y permite rellenarlo |
| Fallback de avatar OAuth inválido (host no permitido o no string) | Se descarta y se cae a iniciales: nunca se renderiza una URL de la metadata sin validar |
| Error de BD en cualquiera de los 5 conteos del historial | `getProfileHistorySummary` lanza con la tabla identificada ("Failed to fetch absences count for user …") — la página de perfil falla alto, no muestra conteos falsos |
| `phone`/`bio`/`avatarUrl` en el listado `/admin/users` | Proyección contact-free (`ProfileListItem`): un miembro con RLS SELECT no puede leerlos vía listado (D6) |
| Admin editando el perfil de un miembro music/dance sin grupo | Regla existente `componentTypeRequiresWorkgroup` se mantiene (validación en el form admin + resolver contra el workgroup efectivo) |

---

## Consecuencias

### Positivas

- Perfiles enriquecidos: avatar con fallback en cascada, bio, teléfono, habilidades (chips) y
  fecha de incorporación, visibles en la cabecera rediseñada de `/profile` y editables por el
  propio miembro desde el formulario ampliado.
- Historial unificado con 5 tiles de conteo en `/profile`, cada uno enlazado a su página
  existente (`/events`, `/profile/history`, `/profile/shifts`) — sin duplicar contenido.
- Validación en dos capas (Zod + CHECKs de BD) con mensajes en español para los campos nuevos
  (criterio de aceptación).
- El admin edita también los campos personales enriquecidos de cualquier miembro (schema
  heredado, D7) con la misma validación.
- Sin dependencias nuevas y sin tocar `next.config.ts`/CSP: toda URL válida es renderizable.
- Suite completa: **745 tests en 50 archivos pasando** (35 nuevos), `tsc --noEmit`,
  `eslint . --max-warnings=0` y security scan **PASS sin issues HIGH** (verificados en local).

### Seguridad (defensa en profundidad)

- **PII**: proyección *lean* en el listado (`ProfileListItem` contact-free) — aunque la RLS
  SELECT permita a cualquier miembro activo leer perfiles, el listado no expone `phone`/`bio`/
  `avatarUrl`; `ProfileDetail` (con contacto) está JSDoc-gateado a management/own y sus call
  sites comprueban rol/sesión.
- **Avatar**: allowlist de hosts espejo de la CSP (con wildcard de `*.supabase.co` como sufijo
  de dominio, sin bypass tipo `evilsupabase.co`/`supabase.co.evil.com`), https obligatorio, y el
  fallback OAuth **también validado** (fix L2, alternativa (f)).
- **Autorización**: own (`requireAuthenticatedProfile` + `.eq("id", profile.id)`) y admin
  (`requireAdmin`) en servidor; RLS intacta como backstop; sin grants `service_role` nuevos.
- **Datos**: `joined_at` futura rechazada en app y BD; `skills` acotada (1–50 chars, ≤10) en
  app y BD.

### Riesgos / pendientes

- **La migración 0051 debe aplicarse antes del deploy**: la app selecciona las columnas nuevas
  (`avatar_url`, `bio`, `phone`, `skills`, `joined_at`) en `session.ts`, `queries.ts` y
  `mutations.ts`; sin la migración, esas queries fallarían. Pendiente de la verificación manual
  (no hay entorno Supabase local).
- **Verificación SQL manual pendiente**: mismo patrón que Sprint 18 — el SQL es hand-reasoned.
  Ver [checklist](#revisión-sql-manual-pendiente).
- `npm audit` pre-existente con hallazgos **INFO** (no introducidos por este sprint; no se
  endurecen aquí).
- **Decisión de producto**: `phone`/`bio`/`avatarUrl` solo visibles en el detalle
  (management/own); el directorio público de miembros sigue **sin datos de contacto** (D6).
- Supabase Storage queda documentado como mejora futura (D2); no hay bucket ni políticas de
  storage en el repo.
- `tasks/sprint-19-profiles-components.json` y `tasks/plan-desarrollo-completo.md` no se tocan
  en los commits (los gestiona el orquestador). Sin PR todavía: commits en
  `feature/sprint-19-profiles-components` siguiendo `docs/git-conventions.md`; el PR y el
  escaneo security-champion los gestiona el pipeline estándar.

---

## Revisión SQL manual (pendiente)

No hay Docker/Supabase local disponible en el entorno de implementación; el SQL es
hand-reasoned. Checklist para la verificación manual antes del deploy:

- [ ] Los 5 `add column if not exists` (avatar_url, bio, phone, skills, joined_at) son
      idempotentes; re-ejecución de estructura sin error.
- [ ] Los 6 CHECK constraints aplican y rechazan: bio > 500 chars; phone fuera de
      `^[+0-9 ()-]{6,20}$`; avatar_url `http://` o > 2048 chars; `array_length(skills, 1) > 10`;
      `joined_at` futura. Re-ejecución de la migración falla limpiamente en los CHECK (sin `IF
      NOT EXISTS`, patrón de 0050) — comportamiento deseado.
- [ ] `skills` NOT NULL default `'{}'`: filas legacy quedan con array vacío, no NULL.
- [ ] Comentarios de columna presentes (semántica `joined_at` vs `created_at`).
- [ ] RLS intacta: `profiles_update_own_or_admin` permite a un miembro actualizar sus propias
      columnas nuevas y a admin/super_admin las de cualquiera; `profiles_select_authenticated`
      permite SELECT (con la proyección que cada query pida).
- [ ] Filas legacy: `avatar_url`/`bio`/`phone`/`joined_at` NULL y `skills` `{}` — `select` de la
      app no peta con los nuevos campos.
- [ ] `supabase db push` aplica la migración 0051 sin errores (o `npm run supabase:reset` en
      local).

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101005100_profiles_enrichment.sql` | CREATE — 5 columnas en `umsuka.profiles` (avatar_url, bio, phone, skills text[] NOT NULL default '{}', joined_at date), 6 CHECK constraints, comentarios de columna; RLS deliberadamente intacta |
| `src/types/database.types.ts` | MODIFY — `avatar_url`/`bio`/`phone`/`joined_at` (nullable) y `skills` (`string[]`) en profiles Row/Insert/Update (hand-authored) |
| `src/lib/profiles/schema.ts` | MODIFY — `AVATAR_ALLOWED_HOSTS`, `isAllowedAvatarUrl`, `normalizeSkills`; `updateOwnProfileSchema` con bio/phone/skills/avatarUrl/joinedAt (mensajes en español); `updateMemberProfileSchema` hereda vía `.extend()` |
| `src/lib/profiles/queries.ts` | MODIFY — `ProfileListItem` contact-free + skills/joinedAt; `ProfileDetail` completo (avatar/bio/phone) con JSDoc SECURITY; `getProfileHistorySummary` (5 counts `head:true` en `Promise.all`, scoped por `user_id`, error con tabla identificada) |
| `src/lib/profiles/mutations.ts` | MODIFY — `updateOwnProfile` y `updateMemberProfile` escriben las 5 columnas nuevas (scoped own / requireAdmin), regla workgroup intacta |
| `src/lib/auth/session.ts` | MODIFY — `fetchProfileRow`/`buildAuthenticatedProfile` con los campos nuevos; fallback en cascada avatar (columna → metadata OAuth validada con `isAllowedAvatarUrl` → null); email alias nunca expuesto |
| `src/types/auth.ts` | MODIFY — `AuthenticatedProfile` con `bio`/`phone`/`skills`/`joinedAt` (requeridos) |
| `src/app/profile/page.tsx` | MODIFY — cabecera rediseñada (avatar + iniciales, badges rol/componente/grupo, bio, contacto, habilidades, "En la comparsa desde"/"Alta de cuenta"); card "Historial" con 5 tiles enlazados; "Datos personales" con form ampliado |
| `src/app/profile/profile-form.tsx` | MODIFY — avatarUrl con previsualización (`isAllowedAvatarUrl`), bio (textarea), phone, skills (`SkillsInput` + `getSkillsErrorMessages`), joinedAt (date) |
| `src/app/profile/skills-input.tsx` | CREATE — input de chips con `Badge` (Enter/coma para añadir, `maxLength=50`, tope 10); `getSkillsErrorMessages` (mensajes raíz + por ítem) |
| `src/app/profile/actions.ts` | (sin cambios) — `updateOwnProfileAction` reenvía el input al resolver ampliado; mantiene revalidación de `/profile` y `/dashboard` |
| `src/app/admin/users/[id]/page.tsx` | MODIFY — `defaultValues` del form con avatarUrl/bio/phone/skills/joinedAt desde `ProfileDetail` |
| `src/app/admin/users/[id]/member-edit-form.tsx` | MODIFY — campos nuevos (misma superficie que el own form + workgroup + userId), previsualización de avatar, `SkillsInput`, regla music/dance-requires-workgroup |
| `src/app/admin/users/actions.ts` | (sin cambios) — `updateMemberProfileAction` reenvía al resolver ampliado |
| `tests/unit/lib/profiles-schema.test.ts` | MODIFY — ampliado con validaciones de bio/phone/skills/avatarUrl/joinedAt, `normalizeSkills`, `isAllowedAvatarUrl`, herencia de `updateMemberProfileSchema` |
| `tests/unit/lib/profiles-mutations.test.ts` | CREATE — 8 tests de mutaciones (escritura de campos enriquecidos scoped own, admin-any, normalización, coerción a null, regla workgroup, errores) |
| `tests/unit/lib/profiles-history-summary.test.ts` | CREATE — 3 tests del resumen (5 counts head-only scoped, fallback a 0, throw con tabla identificada) |
| `tests/unit/lib/votings-mutations.test.ts` | MODIFY — fixture `AuthenticatedProfile` + bio/phone/skills/joinedAt |
| `tests/unit/lib/admin-set-component-lead.test.ts` | MODIFY — fixture `AuthenticatedProfile` + bio/phone/skills/joinedAt |
| `tests/unit/lib/events-audience-mutations.test.ts` | MODIFY — fixture `AuthenticatedProfile` + bio/phone/skills/joinedAt |
| `docs/adr-sprint-19-profiles-components.md` | CREATE — este ADR |

### Tests

| Archivo | Tests |
|---|---|
| `tests/unit/lib/profiles-schema.test.ts` (MODIFY) | +24 — bio (trim/500/coerción a null), phone (regex permisivo, longitud), skills (normalización, dedupe, límites 10/50, default), avatarUrl (allowlist: hosts válidos, `*.supabase.co`, rechazo http/host malo/malformado, coerción), joinedAt (válida, vacía→null, futura→rechazo), `normalizeSkills`, `isAllowedAvatarUrl`, `updateMemberProfileSchema` (herencia y reglas heredadas) |
| `tests/unit/lib/profiles-mutations.test.ts` (CREATE) | 8 — updateOwnProfile (escritura de campos enriquecidos scoped `eq("id", actor)`, normalización de skills, coerción '', regla workgroup sin tocar BD, input inválido sin tocar BD, errores verbatim) y updateMemberProfile (rechazo no-admin, escritura admin con workgroup efectivo) |
| `tests/unit/lib/profiles-history-summary.test.ts` (CREATE) | 3 — 5 counts `head:true` scoped al usuario (split attended true/false), fallback a 0 con counts null, throw identificando la tabla fallida |

**Total de la suite: 745 tests en 50 archivos, todos pasando** (`npx vitest run`).
`npx tsc --noEmit`, `npx eslint . --max-warnings=0` y security scan sin issues HIGH, limpios en
local tras el sprint.