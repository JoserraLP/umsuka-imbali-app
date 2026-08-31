# ADR-040: Sprint 40 — Alta de Miembros sin Gmail y Vinculación Posterior

**Status:** Accepted (Implementado) · **Date:** 2026-08-31 · **Sprint:** 40 ·
**Branch:** `feature/sprint-40-pre-register-link-gmail`

---

## Context

La comparsa necesita **poblar la base de miembros por adelantado** antes de que cada persona disponga o facilite su cuenta de Gmail. Hoy el alta requiere Gmail + OAuth; eso bloquea la carga inicial del ciclo y obliga a la directiva a esperar al registro individual. El `super_admin` debe poder **dar de alta perfiles completos sin Gmail** (datos personales, `component_type`, `workgroup`, rol inicial, `is_minor`, `document_id` opcional) que queden en estado **pendiente de vinculación** y sean visibles en listados con badge, pero **sin acceso a la app** hasta vincular.

Al facilitar el Gmail (o al registrarse con el enlace de invitación), el `super_admin` **vincula ese Gmail al perfil pre-creado**, convirtiéndolo en cuenta activa **sin duplicar el perfil ni perder histórico** ya asociado (pagos `member_payments`, formación `dance_formations`/`dance_positions`, asistencia `attendance`/`rehearsal_attendance`, `musician_instruments`, `shifts`, etc.). Se requiere además un flujo opcional de **auto-vinculación por `invite_token`** en `/invite/<token>`.

Requisitos (`tasks/sprint-40-pre-register-link-gmail.json`):

- Solo `super_admin` crea perfiles sin Gmail (`link_status='pending_gmail'`), visibles con badge y sin acceso hasta vincular.
- Vinculación posterior por Gmail sin duplicar perfil y conservando histórico.
- Si el Gmail ya pertenece a otro perfil `linked`, la vinculación falla con error claro es-ES.
- Perfiles pendientes filtrables en listados (`Pendientes de Gmail` / `Vinculados`).
- Miembro pendiente no puede iniciar sesión (bloqueo por `link_status`).
- Auto-vinculación opcional por `invite_token` (`/invite/<token>`) al registrarse con Gmail.

Dependencias: Sprint 6 (Registration Approval), Sprint 7 (Emailless Accounts), Sprint 19 (Perfiles), Sprint 2/21 (Roles `super_admin`).

Última migración: `20260101007200_carnival_year.sql`; este sprint añade **0073**.

---

## Decisión

### D1 — ENUM `umsuka.link_status` cerrado (2 valores)

```sql
do $$ begin
  create type umsuka.link_status as enum ('pending_gmail', 'linked');
exception when duplicate_object then null;
end $$;

comment on type umsuka.link_status is
  'Estado de vinculación Gmail: pending_gmail = pre-registrado sin Gmail, linked = vinculado con Gmail.';
```

- `pending_gmail` = alta sin Gmail (pendiente vinculación). `linked` = cuenta vinculada (default).
- Enum cerrado evita estados intermedios; añadir un tercer estado requeriría migración explícita. Idempotente vía `duplicate_object`.
- Alternativa "boolean `is_pending_gmail`" descartada: enum es extensible y tipado en Zod/TS (`LinkStatus`).

### D2 — Columnas en `umsuka.profiles`

```sql
alter table umsuka.profiles add column if not exists link_status umsuka.link_status not null default 'linked'::umsuka.link_status;
alter table umsuka.profiles add column if not exists pre_registered_by uuid references umsuka.profiles(id) on delete set null;
alter table umsuka.profiles add column if not exists invite_token text;
alter table umsuka.profiles add column if not exists pending_email text;

comment on column umsuka.profiles.link_status is 'pending_gmail = alta sin Gmail (pendiente vinculación), linked = cuenta vinculada. Default linked para existentes.';
comment on column umsuka.profiles.pre_registered_by is 'Super admin que pre-registró el miembro. FK SET NULL.';
comment on column umsuka.profiles.invite_token is 'Token UUID invitacion para /invite/<token>. UNIQUE parcial WHERE NOT NULL.';
comment on column umsuka.profiles.pending_email is 'Email pendiente opcional capturado en pre-registro.';

update umsuka.profiles set link_status = 'linked'::umsuka.link_status where link_status is null;
```

- `link_status NOT NULL DEFAULT 'linked'` garantiza backfill: todos los existentes quedan `linked` sin sobrescribir futuros `pending_gmail`.
- `pre_registered_by FK SET NULL` audita quién pre-registró; si el admin se borra no se borra el miembro.
- `invite_token text nullable` + `pending_email text nullable`: `pending_email` es la **fuente autoritativa del email tras vincular** — `profiles` no tiene columna `email` dedicada en este proyecto (ver trade-off id lógico).
- `CHECK` coherencia suave (idempotente):

```sql
do $$ begin
  alter table umsuka.profiles add constraint chk_profiles_link_status_coherence
    check (
      (link_status = 'linked' and (invite_token is null or char_length(invite_token) >= 8))
      or
      (link_status = 'pending_gmail' and (invite_token is null or char_length(invite_token) >= 8))
    );
exception when duplicate_object then null;
end $$;
```

Ambos estados exigen `invite_token >= 8` si no es null (UUID 36 chars); evita tokens basura.

### D3 — Índices parciales

```sql
create unique index if not exists uniq_profiles_invite_token on umsuka.profiles (invite_token) where invite_token is not null;
create unique index if not exists uniq_profiles_pending_email on umsuka.profiles (pending_email) where pending_email is not null;
create index if not exists idx_profiles_link_status on umsuka.profiles (link_status);
create index if not exists idx_profiles_pre_registered_by on umsuka.profiles (pre_registered_by);
```

- `UNIQUE WHERE NOT NULL` para `invite_token` y `pending_email`: permite múltiples `NULL` pero impide duplicar tokens/emails cuando existen. Base de la detección de colisión en `linkGmailToProfile`.
- `idx_link_status` acelera filtros `WHERE link_status='pending_gmail'` en `/admin/members` y `/members`.
- `idx_pre_registered_by` para auditoría por admin.

### D4 — RLS `ENABLE + FORCE` (fail-closed para columnas sensibles)

```sql
alter table umsuka.profiles enable row level security;
alter table umsuka.profiles force row level security;

drop policy if exists "profiles_select_authenticated" on umsuka.profiles;
create policy "profiles_select_authenticated"
  on umsuka.profiles for select to authenticated
  using (umsuka.is_active_member() or id = auth.uid());

drop policy if exists "profiles_insert_pre_register_super_admin" on umsuka.profiles;
create policy "profiles_insert_pre_register_super_admin"
  on umsuka.profiles for insert to authenticated
  with check (umsuka.is_super_admin());

-- HIGH 4 fix: exclusiva is_super_admin(), sin OR id=auth.uid()
drop policy if exists "profiles_update_link_super_admin" on umsuka.profiles;
create policy "profiles_update_link_super_admin"
  on umsuka.profiles for update to authenticated
  using (umsuka.is_super_admin())
  with check (umsuka.is_super_admin());

grant select, insert, update, delete on table umsuka.profiles to authenticated;
grant all on table umsuka.profiles to service_role;
```

- `SELECT authenticated` mantiene regla existente: miembros `active` ven todos, resto solo `own` (`id = auth.uid()`), pero `pending_gmail` queda **filtrable** en UI (no bloqueado en DB, filtro en app).
- `INSERT` solo `is_super_admin()` — non-super_admin `INSERT pending_gmail` falla RLS (42501).
- `UPDATE link` solo `is_super_admin()` — corrige HIGH 4: antes permitía `OR id=auth.uid()` lo que habría dejado a un usuario cambiar su propio `link_status`; ahora exclusivo super_admin. Si existe otra policy `update_own` permisiva, se documenta alternativa trigger `BEFORE UPDATE` que eleva error si `OLD.link_status != NEW.link_status` y caller no es `super_admin` (mitigación por si auditoría detecta bypass por evaluación permissive de policies).
- `service_role` bypass para `admin` client en server actions.

### D5 — Helper `umsuka.current_user_link_status()` (SECURITY DEFINER)

```sql
create or replace function umsuka.current_user_link_status()
returns text language sql stable security definer set search_path = umsuka, public
as $$ select link_status::text from umsuka.profiles where id = auth.uid(); $$;

comment on function umsuka.current_user_link_status() is
  'Devuelve link_status del usuario actual (pending_gmail/linked) o null si no existe.';
grant execute on function umsuka.current_user_link_status() to authenticated;
```

- Usado en `middleware.ts` vía `supabase.rpc("current_user_link_status")` para decidir bloqueo. `STABLE + SECURITY DEFINER` evita RLS recursiva.
- Retorna `null` si no hay perfil (fail-open a no bloquear, deja pasar a login/onboarding).
- Alternativa "consultar `profiles` directo en middleware" descartada: requiere `select` con RLS que puede ser 0 rows por policy `is_active_member`; RPC con definer es determinista.

### D6 — Capa `lib/members/pre-register-schema.ts` + `lib/members/pre-register.ts` (vinculación LÓGICA)

**Schema Zod (mensajes es-ES):**

```ts
export const preRegisterMemberSchema = z.object({
  first_name: z.string().trim().min(1, "El nombre es obligatorio.").max(100, "El nombre no puede superar 100 caracteres."),
  last_name: z.string().trim().min(1, "Los apellidos son obligatorios.").max(100, "Los apellidos no pueden superar 100 caracteres."),
  birth_date: z.string().nullable().optional(),
  component_type: z.enum(["music","dance","member"], { errorMap: () => ({message:"Tipo de miembro no válido."}) }),
  workgroup: z.enum(["telas","barra","estandarte","limpieza","ninguno"], { errorMap: () => ({message:"Grupo de trabajo no válido."}) }),
  role: z.string().trim().min(1,"El rol es obligatorio.").max(50).optional().default("member"),
  is_minor: z.boolean().optional().default(false),
  document_id: z.string().trim().max(20,"El documento no puede superar 20 caracteres.").optional().nullable(),
  pending_email: z.string().trim().email("El email pendiente no tiene un formato válido.").optional().nullable(),
});

export const linkGmailSchema = z.object({
  profileId: z.string().uuid("El identificador del perfil no es válido."),
  gmail: z.string().trim().email("El Gmail no tiene un formato válido.").min(5,"El Gmail es obligatorio."),
  invite_token: z.string().trim().min(8,"El token de invitación no es válido.").optional().nullable(),
});
```

**Lógica `preRegisterMember(data)` y `linkGmailToProfile(profileId,gmail)`:**

```ts
// 1. requireSuperAdminGuard(profile) fail-closed → AuthorizationError("Solo el super_admin puede realizar esta acción.")
// 2. preRegisterMember: valida Zod → admin.from("profiles").insert({
//      id: crypto.randomUUID(), first_name, last_name, birth_date, component_type,
//      workgroup, role:"member", is_minor, link_status:"pending_gmail",
//      pre_registered_by: actor.id, invite_token: crypto.randomUUID(), pending_email, is_active:true, status:"active"
//    }).select("id, invite_token").single()
// 3. linkGmailToProfile: valida Zod → collision check
//      admin.from("profiles").select("id").eq("pending_email",gmail).eq("link_status","linked").maybeSingle()
//      → si existe: "El Gmail ya pertenece a otro perfil vinculado."
//    verifica target exists + link_status==='pending_gmail' else "El perfil no está pendiente de vinculación."
//    si invite_token aportado y no coincide → "Token de invitación no válido."
//    UPDATE lógica: admin.from("profiles").update({ link_status:"linked", invite_token:null, pending_email:gmail }).eq("id",profileId)
//    conserva histórico (no toca PK ni FKs)
```

**Trade-off crítico — id LÓGICO vs FÍSICO (documentado en header de `pre-register.ts`):**

| Opción | Por qué se descarta / elige |
|---|---|
| `UPDATE profiles.id = auth.uid()` (físico) | Rompería todas las FKs que ya apuntan al `id` pre-registrado (`member_payments.user_id`, `dance_positions.member_id`, `musician_instruments.user_id`, `attendance.user_id`, etc.) — histórico huérfano masivo. Requeriría migración de todas las tablas hijas en transacción. |
| **Elegido: vinculación LÓGICA** | `preRegisterMember` genera `id = crypto.randomUUID()` para el perfil `pending_gmail`; ese `id` es la PK que ya usan las FKs de histórico. `linkGmailToProfile` / `linkByInviteToken` **no migran PK**; hacen `UPDATE SET link_status='linked', invite_token=null, pending_email=gmail WHERE id=profileId` sobre el **mismo id original**. El histórico queda intacto. Login futuro resuelve por `WHERE pending_email=gmail AND link_status='linked'` (si se añade `profiles.email`, sería `WHERE email=gmail OR pending_email=gmail AND linked`). |

- También `linkByInviteToken(token,gmail)` para auto-vinculación: valida `token.length>=8`, `auth.getUser()`, busca por `invite_token`, colisión, y `UPDATE` lógica idéntica.

### D7 — Server Actions thin `src/lib/members/pre-register-actions.ts`

```ts
"use server";
export async function preRegisterMemberAction(input: PreRegisterMemberInput) {
  const result = await preRegisterMember(input);
  if (result.success) { revalidatePath("/admin/members"); revalidatePath("/members"); revalidatePath("/profile"); }
  return result;
}
export async function linkGmailAction(input: LinkGmailInput) {
  const result = await linkGmailToProfile(input);
  if (result.success) { revalidatePath("/admin/members"); revalidatePath("/members"); revalidatePath("/profile"); }
  return result;
}
export async function linkByInviteTokenAction(token: string, gmail: string) {
  const result = await linkByInviteToken(token, gmail);
  if (result.success) { revalidatePath("/admin/members"); revalidatePath("/members"); }
  return result;
}
```

- Guards `is_super_admin` dentro de `pre-register.ts` (fail-closed); actions solo revalidan. Patrón idéntico a `carnival/actions.ts`, `meetings/actions.ts`.
- `invite_token` generado con `crypto.randomUUID()` (v4 UUID, 122 bits entropía) en capa lib, no en DB default.

### D8 — UI admin / invite / filtros

**`/admin/members` (solo `super_admin`):**

- Guard `if (!profile) redirect("/auth/login"); if (profile.role !== "super_admin") redirect("/dashboard")`.
- `PreRegisterForm` (client): botón `Alta sin Gmail` → form card con `Input` nombre/apellidos, `Select` `component_type` (music/dance/member), `Select` `workgroup` (telas/barra/estandarte/limpieza/ninguno), checkbox `Es menor de edad`, `Input` email pendiente opcional. Submit llama `preRegisterMemberAction`; éxito muestra `Token: <uuid>` + code `/invite/<token>` con botón `Copiar enlace` (`navigator.clipboard.writeText(origin + link)`), errores es-ES, `router.refresh()`.
- Listado: `admin.from("profiles").select("id, first_name, last_name, component_type, workgroup, link_status, invite_token, pending_email, created_at").order("created_at",desc).limit(100)` filtrado en JS por `memberFiltersSchema` (`linkStatus`, `workgroup`, `componentType`, `q`). Para cada fila: `Badge Pendiente de Gmail` (secondary) vs `Vinculado` (default), línea `component_type — workgroup — pending_email ?? "sin email"`, `Invite: /invite/<token>` si existe, botón `Vincular Gmail` (solo si `pending_gmail && invite_token`).
- `LinkGmailDialog` (client): botón `Vincular Gmail` → card con `Input type=email` + `linkGmailAction({profileId, gmail, invite_token})`; errores `El Gmail ya pertenece a otro perfil vinculado.` / `Token de invitación no válido.` / `El perfil no está pendiente de vinculación.`, éxito `Gmail vinculado correctamente.` + `router.refresh()`.
- `memberFiltersSchema` (`src/lib/members/schema.ts`) añade `LINK_STATUS_OPTIONS = ["pending_gmail","linked"]` + `linkStatus` enum; `MemberListItem` extiende `linkStatus`, `inviteToken`, `pendingEmail`; helper `withLinkDefaults` para fixtures.

**`/invite/[token]` (auto-vinculación):**

- Si `!user` → `redirect(/auth/login?redirectTo=/invite/<token>)` (preserva token tras login OAuth).
- `admin.from("profiles").select("id, first_name, last_name, link_status, invite_token").eq("invite_token",token).maybeSingle()`; si no existe → card `Token no válido / El enlace de invitación no existe o ya fue usado.`; si `link_status !== pending_gmail` → `Ya vinculado`.
- `gmail = user.email`; si `!gmail` → `Sin Gmail`. Colisión `pending_email=gmail && linked` → `Colisión / Este Gmail ya pertenece a otro perfil.`; else `UPDATE lógica` idéntica + card `¡Vinculación completada! Tu Gmail <gmail> ha sido vinculado al perfil <first last>.` + link `/dashboard`.

**`/members` filtros:**

- `memberFiltersSchema` con `linkStatus` permite `?linkStatus=pending_gmail|linked|all` en `/admin/members` y `/members`; `MemberFiltersControl` propaga `linkStatus` a `basePath`.

### D9 — Middleware block (`src/lib/supabase/middleware.ts` + `auth-gate.ts`)

```ts
// middleware.ts
const { data: linkStatus } = await supabase.rpc("current_user_link_status" as never);
if (isPendingGmail(linkStatus as string | null)) {
  return redirectPreservingCookies(new URL("/auth/pending", request.url), supabaseResponse);
}

// auth-gate.ts
export function isPendingGmail(linkStatus: string | null): boolean {
  return linkStatus === "pending_gmail";
}
```

- Tras `current_user_status` check (`pending/suspended → /auth/pending`), se consulta `current_user_link_status`; si `pending_gmail` → redirect `/auth/pending` con `redirectPreservingCookies` (preserva `Set-Cookie` refreshed). `/invite/*` está en `PUBLIC_ROUTES` por lo que no se bloquea (permite auto-vinculación sin bucle).
- Orden: `pending/suspended` primero, luego `pending_gmail`, luego `requiresWorkgroupOnboarding` — pending_gmail ve `/auth/pending` antes que onboarding.
- Invariante: perfil `pending_gmail` **no puede usar la app** aunque tenga sesión válida; solo tras `linked` pasa.

---

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Tabla separada `pending_members` con migración posterior a `profiles` | Duplica esquema (dos tablas con mismas columnas), obliga a `INSERT INTO profiles SELECT` + remap FKs hijas; columnas en `profiles` con `link_status` es más simple y conserva PK/histórico sin migración. |
| `email` columna dedicada vs `pending_email` | `profiles` no tiene `email` (usa `auth.users.email` + `username`/`email_aliases` para emailless). Añadir `email` habría requerido migración masiva y backfill; `pending_email` reutiliza campo nullable sin romper legacy. Futuro: si se añade `email`, query será `WHERE email=gmail OR pending_email=gmail`. |
| Trigger `BEFORE UPDATE` para validar `link_status` vs RLS exclusiva | Trigger oculta lógica, requiere `SECURITY DEFINER` y no notifica UI; RLS `is_super_admin()` exclusivo es declarativo y testeable con `anon`/`authenticated` policies. Trigger documentado como plan B si auditoría detecta bypass por otra policy permissive. |
| Bucket / tabla de invitaciones separada | `invite_token` en `profiles` permite `UNIQUE parcial` + lookup directo `WHERE invite_token=token`; tabla separada añadiría join y FK extra sin beneficio. |
| `UPDATE id = auth.uid()` físico | Rompe FKs históricas (pagos, formación, asistencia) — crítico descartado (ver D6 trade-off). |
| Middleware consultar `profiles` directo vs RPC | `select` directo sufre RLS (`is_active_member`) que puede devolver 0 rows para `pending_gmail`; RPC `SECURITY DEFINER` es determinista y desacopla RLS de auth gate. |
| Borrar `invite_token` con `DELETE` fila | Se conserva fila perfil; solo se limpia token (`invite_token=null`) al vincular, preservando auditoría `pre_registered_by`. |

---

## Consecuencias

- **Positivo:** super_admin puebla comparsa sin esperar Gmail; histórico huérfano imposible (vinculación lógica); RLS fail-closed para ops sensibles; middleware bloquea acceso `pending_gmail`; filtros por `link_status` en listados; auto-vinculación por enlace sin intervención manual; tipos `LinkStatus` hand-edited coherentes con migración; migración idempotente con checklist 10 puntos; mensajes es-ES consistentes.
- **Negativo:** `invite_token` visible en `/admin/members` como texto `/invite/<token>` (enumerable UUID) — hallazgo **MEDIUM** del security scan (ver Seguridad). `pending_email` `UNIQUE WHERE NOT NULL` impide re-usar un email capturado como pendiente en otro pre-registro aunque aún no vinculado (colisión temprana; deseable para no duplicar, pero bloquea alias hasta vincular). `pending_gmail` queda visible en `SELECT` (filtrable) — no es secreto, pero expone conteo de pendientes a miembros `active`.
- **Trade-off seguridad:** `invite_token` `crypto.randomUUID()` (122 bits) es impredecible pero URL enumerable si se filtra en logs/referrers; no hay expiración; mitigación futura: añadir `invite_expires_at` + rate limit + regeneración + no mostrar token completo en UI (solo botón copiar con `***`). Por ahora el riesgo es MEDIUM, no HIGH.
- **Trade-off UX:** listado `/admin/members` hace `select limit 100` client-side filter (no paginado por `link_status` en DB); para >100 miembros el filtro JS puede no ver todos los pendientes (paginación futura).

---

## Edge cases y trade-offs (seguridad)

- `preRegisterMember` sin `pending_email` → `invite_token` generado igualmente; invitación por enlace sigue funcionando (token obligatorio para `/invite`).
- `linkGmailToProfile` con `gmail` ya en `pending_email linked` → error `El Gmail ya pertenece a otro perfil vinculado.` (42501 no, error de negocio es-ES).
- `linkGmailToProfile` con `invite_token` aportado pero distinto al stored → `Token de invitación no válido.` (no se vincula).
- `linkGmailToProfile` sobre perfil ya `linked` → `El perfil no está pendiente de vinculación.`
- `linkByInviteToken` con `token.length < 8` → `Token no válido.` antes de DB.
- `linkByInviteToken` sin sesión (`!user`) → `No autenticado.` (invite page redirige a login con `redirectTo`).
- `/invite/[token]` con token inexistente → `Token no válido` (ya usado → `invite_token=null` tras vincular, por eso `maybeSingle` null).
- `/invite/[token]` con token de perfil ya `linked` → `Ya vinculado`.
- `/invite/[token]` colisión `pending_email=gmail linked` → `Colisión`.
- Middleware `current_user_link_status()` null (sin perfil) → no bloquea (deja pasar a onboarding/login).
- Re-ejecutar `preRegisterMember` con mismo `pending_email` → falla `UNIQUE pending_email WHERE NOT NULL` (PG 23505) mapeado a `No se pudo pre-registrar: ...` (no duplicado silencioso).
- Non-super_admin invoca `preRegisterMember`/`linkGmailToProfile` → `AuthorizationError` → `Solo el super_admin puede realizar esta acción.` (fail-closed, RLS también bloquearía si se intentara bypass directo).
- `anon` SELECT `profiles` → 0 rows (FORCE RLS sin policy `anon`).

### Hallazgo Security Scan — MEDIUM (documentado)

- **ID:** `invite_token enumerable` — `profiles.invite_token` es UUID legible vía `SELECT` (authenticated) y se muestra en `/admin/members` como `/invite/<token>` en texto plano. Un miembro `active` autenticado puede enumerar tokens de perfiles `pending_gmail` al listar `/admin/members` si obtiene acceso a esa ruta (aunque la ruta está guardada solo `super_admin` en page guard, la policy `SELECT` permite ver `invite_token` a `authenticated` con `is_active_member`). El token es la única barrera para auto-vinculación; conocerlo permite a un atacante registrarse con Gmail y reclamar el perfil pendiente si intercepta el enlace (p. ej. referrer, logs, shoulder-surfing).
- **Severidad:** **MEDIUM** (no HIGH: requiere sesión autenticada + acceso a token; token es UUID v4 122 bits no bruteforceable; no expone PII directa).
- **Mitigación actual:** `invite_token` solo se genera con `crypto.randomUUID()`, `UNIQUE WHERE NOT NULL`, se limpia a `null` tras vincular (one-time), y `linkGmailToProfile` verifica colisión + `pending_gmail` status. `/invite` está en `PUBLIC_ROUTES` pero vincula al `user.email` actual (no a email arbitrario).
- **Mitigación futura (no bloqueante Sprint 40):** (1) no exponer `invite_token` completo en UI — mostrar solo botón `Copiar enlace` con `***` y audit log de copias; (2) añadir `invite_expires_at timestamptz` (p. ej. 7 días) + job de limpieza; (3) restringir `SELECT invite_token` a `is_super_admin()` vía vista o columna con RLS column-level (Supabase no soporta column-level RLS nativa; alternativa: vista `profiles_public` sin token); (4) rate-limit `/invite/[token]` y log de intentos fallidos; (5) regeneración de token bajo demanda. Estas mejoras se proponen como tech-debt sin bloquear `Accepted` — security scan queda sin **HIGH**.

---

## Verificación

Checklist idempotente migración `20260101007300` (10 puntos del DoD):

1. `TYPE link_status` existe (`pending_gmail`,`linked`) idempotente `duplicate_object`.
2. Columnas `link_status NOT NULL DEFAULT linked`, `pre_registered_by FK SET NULL`, `invite_token text`, `pending_email text` existen (`ADD COLUMN IF NOT EXISTS`) + comentarios `pg_description`.
3. Backfill existentes → `linked` (`WHERE link_status is null`).
4. `CHECK chk_profiles_link_status_coherence` existe (`invite_token >=8` si not null).
5. Índices `uniq_profiles_invite_token WHERE NOT NULL`, `uniq_profiles_pending_email WHERE NOT NULL`, `idx_profiles_link_status`, `idx_profiles_pre_registered_by`.
6. Helper `current_user_link_status() SECURITY DEFINER STABLE` existe + `GRANT EXECUTE to authenticated`.
7. RLS `ENABLE+FORCE` + 3 policies: `profiles_select_authenticated (is_active_member() or id=auth.uid())`, `profiles_insert_pre_register_super_admin (is_super_admin())`, `profiles_update_link_super_admin (solo is_super_admin() — HIGH 4 fix)` + grants.
8. Non-super_admin `INSERT pending_gmail` falla RLS; super_admin puede `INSERT` y `UPDATE link` a `linked`.
9. Re-run idempotente (`IF NOT EXISTS`, `ON CONFLICT`, `duplicate_object`, `DROP POLICY IF EXISTS`).
10. Tipos `LinkStatus` + `profiles Row/Insert/Update` + `Enums` + `current_user_link_status` en `database.types.ts` hand-edited coherentes.

Tests / build (DoD):

- `tsc --noEmit` y `eslint` limpios; `next build` sin errores.
- Tests unitarios nuevos pasando (`pre-register schema`, `linkGmail colisión/token inválido/solo super_admin`, histórico conservado) + suite completa `npx vitest run`.
- Security scan sin issues **HIGH** (1 MEDIUM documentado arriba).

---

## Cambios

- `supabase/migrations/20260101007300_pre_register_link.sql` — CREATE (ENUM, columnas, CHECK, índices, helper, RLS + grants, checklist 10 pts).
- `src/types/database.types.ts` — `LinkStatus` + `profiles Row/Insert/Update` con `link_status`, `pre_registered_by`, `invite_token`, `pending_email` + `Enums link_status` + `Functions current_user_link_status`.
- `src/lib/members/pre-register-schema.ts` — `preRegisterMemberSchema` (first_name 1-100, last_name 1-100, birth_date nullable, component_type, workgroup, role, is_minor, document_id, pending_email) + `linkGmailSchema` (profileId uuid, gmail email, invite_token) mensajes es-ES.
- `src/lib/members/pre-register.ts` — `preRegisterMember`, `linkGmailToProfile`, `linkByInviteToken` con `requireSuperAdminGuard` fail-closed, colisión por `pending_email linked`, vinculación LÓGICA (sin `UPDATE id`), `invite_token crypto.randomUUID()`, admin bypass.
- `src/lib/members/pre-register-actions.ts` — `preRegisterMemberAction`, `linkGmailAction`, `linkByInviteTokenAction` thin con `revalidatePath("/admin/members","/members","/profile")`.
- `src/lib/members/schema.ts` — `LINK_STATUS_OPTIONS`, `memberFiltersSchema.linkStatus`, `MemberListItem.linkStatus/inviteToken/pendingEmail`, `withLinkDefaults`.
- `src/lib/supabase/auth-gate.ts` — `isPendingGmail(linkStatus)`.
- `src/lib/supabase/middleware.ts` — `rpc current_user_link_status` + `isPendingGmail` → redirect `/auth/pending` (preserva cookies), `/invite` en `PUBLIC_ROUTES`.
- `src/app/admin/members/page.tsx` — solo `super_admin`, `PreRegisterForm`, listado con `Badge Pendiente de Gmail / Vinculado`, `MemberFiltersControl` con `linkStatus`, `LinkGmailDialog`, filtro `?linkStatus=pending_gmail|linked`.
- `src/app/admin/members/pre-register-form.tsx` — client form `Alta sin Gmail` sin email obligatorio, muestra card pendiente + copiar enlace `/invite/<token>`.
- `src/app/admin/members/link-gmail-dialog.tsx` — diálogo `Vincular Gmail` + `linkGmailAction` + éxito/error colisión.
- `src/app/invite/[token]/page.tsx` — auto-vinculación por `invite_token` (redirect login con `redirectTo`, colisión check, `UPDATE` lógica, cards `Token no válido`/`Ya vinculado`/`Colisión`/`¡Vinculación completada!`).
- `docs/adr-sprint-40-pre-register-link-gmail.md` — este ADR.
- `tasks/sprint-40-pre-register-link-gmail.json` — task (branch `feature/sprint-40-pre-register-link-gmail`, status `security-cleared` → `documented`).

---

## Referencias

- `tasks/sprint-40-pre-register-link-gmail.json` (AC 6 + DoD 13 + dependencies Sprint 6/7/19/2/21)
- `tasks/plan-desarrollo-completo.md` §Sprint 40
- `docs/git-conventions.md` — `feature/sprint-40-pre-register-link-gmail`, commits `feat(sprint-40): ...`, PR `[feature] Sprint 40 — ...` contra `master`
- `supabase/migrations/20260101007200_carnival_year.sql` (patrón ENUM + RLS + helper)
- `supabase/migrations/20260101007100_meeting_minutes.sql` (Storage RLS patrón, `is_management` vs `is_super_admin`)
- `src/lib/members/*` (schema, authorization), `src/lib/auth/session.ts` (`getCurrentProfile`), `src/lib/supabase/admin.ts` (`createAdminClient`)
- `src/app/members/member-filters.tsx` (filtros `workgroup`/`componentType`/`status` reuse)
- `docs/adr-sprint-38-new-carnival-year.md`, `docs/adr-sprint-34-meeting-minutes-summary.md` (plantilla estructura)

