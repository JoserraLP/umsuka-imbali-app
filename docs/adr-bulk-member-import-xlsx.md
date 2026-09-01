# ADR — Importación masiva desde XLSX, gestión de menores y conversión pendiente → local

## Contexto

La comparsa necesita dar de alta 135 miembros (125 adultos + 10 niños) desde el listado `LISTADO PARA SORTEO 5 ENERO 2027.xlsx` (sheet `LISTADO PAPELETAS`). El alta manual es inviable y propensa a errores (nombres en mayúsculas, sufijos `-NUEVO`/`-V.EXC`, coma en `RODRIGUEZ VALVERDE,BRIAN`). Además surgen necesidades:

- Menores requieren representante legal (`legal_guardians` + `profiles.is_minor` + `legal_guardian_id`).
- Queda pendiente vincular Gmail (`link_status=pending_gmail` + `invite_token`) y mostrar correctamente `Vinculado a Gmail` vs `Cuenta local` (`auth_method=email_alias`).
- Debe ser posible importar como **pre-registro pendiente** y que el `super_admin` luego lo convierta a **cuenta local** (usuario/contraseña) o lo vincule a Gmail, conservando histórico (pagos, asistencia, formación).
- Necesidad de borrar masivamente lo importado y de unificar duplicados (cuenta del script vs cuenta Google previa).
- Error en producción: `permission denied for table legal_guardians` al crear guardián compartido vía `service_role`.

## Decisión

**1. Scripts en `scripts/` (service_role, sin RLS):**
- `import-members-from-xlsx.ts` — lee XLSX con `exceljs`, limpia sufijos, normaliza `Ñ`/comas, parsea `APELLIDOS NOMBRE` a `{firstName,lastName}` en **CamelCase** (`toTitleCase` con partículas `del/de/la` en minúscula) y `toTitleCase` para guardianes. Genera `username` slug (`[a-z0-9_]` 3-30, dedup `_1`) y `password` segura (`passwordStrengthSchema`). Dos modos:
  - `email_alias` (default): `auth.admin.createUser(emailAlias=user-{uuid}@umsuka.internal)` + `rpc(create_emailless_profile)` + `UPDATE is_minor`.
  - `pending_gmail` (`--pending-gmail`): crea placeholder `auth.users` (`pending-{uuid}@umsuka.pending`) para satisfacer `FK profiles_id_fkey`, luego `UPDATE profiles` a `link_status=pending_gmail`, `invite_token=UUID`, `auth_method=google`, `pre_registered_by`. Genera CSV con `invite_url=/invite/<token>`. `is_minor` + `legal_guardians` (shared/per-child, opcional `is_member` vinculado a adulto existente) igual en ambos modos.
- `delete-members-from-xlsx.ts` — mismo parseo, matching por `username` (o `--by-name`), `auth.admin.deleteUser` (CASCADE) + opcional `legal_guardians` huérfanos.
- `unify-accounts.ts` — fusiona duplicados: migra todas las FKs `user_id`/`created_by`/`member_user_id` (maneja UNIQUE `rehearsal_attendance`, `event_registrations`, `voting_votes`, `user_preferences`), borra `email_aliases`/`password_tokens` y `auth.users` duplicado.
- `convert-pending-to-local.ts` — bulk `pending_gmail` → `email_alias`: `updateUserById(aliasEmail)`, `UPDATE profiles (username, auth_method, link_status=linked)`, `INSERT email_aliases`.

**2. Conversión gestionada por `super_admin`:**
- `src/lib/members/convert-to-local.ts` (`convertPendingToLocal` / `revertLocalToPending`) con `SECURITY DEFINER` vía `service_role` y validación `super_admin` + `pending_gmail` + username único + `passwordStrengthSchema`.
- UI `src/app/admin/members/convert-to-local-dialog.tsx` + `convert-actions.ts` integrado en `src/app/admin/members/page.tsx` junto a `LinkGmailDialog` (solo para `pending_gmail`).

**3. Fix de vinculación (issue usuario):**
- `src/app/members/page.tsx`, `src/app/members/[id]/page.tsx`, `src/app/admin/members/page.tsx`, `src/app/members/member-filters.tsx`: si `auth_method=email_alias` → badge `Cuenta local` (outline), si `pending_gmail` → `Pendiente de Gmail` (secondary), si `linked+google` → `Vinculado a Gmail` (outline). Filtro renombrado `Vinculado` → `Vinculado a Gmail`.

**4. Fix permisos:**
- `supabase/migrations/20260101007400_legal_guardians_service_role_grants.sql` — `GRANT ALL ON TABLE umsuka.legal_guardians TO service_role, authenticated` (RLS `is_management()` ya existía). El script ahora además loguea `[fix]` con `GRANT` manual para Dashboard si falla.

**5. Cambios config:**
- `package.json` scripts `members:import`, `members:import:dry`, `members:delete`, `members:convert` + deps `exceljs`, `dotenv`, `tsx`.
- `.gitignore` ignora `scripts/data/*.csv` (credenciales).

## Consecuencias

- Positivo: Alta masiva en minutos, nombres normalizados, guardianes opcionales, pendiente ↔ local bidireccional, histórico preservado (misma PK), UI no miente sobre Gmail, import `pending_gmail` desbloquea flujo invitaciones.
- Negativo: Placeholder `auth.users` para pendientes ocupa fila en `auth` (no usado para login, solo FK). Requiere grant manual en producción hasta `db push` de la migración 074.
- Riesgo mitigado: `dry-run` + CSV + dedup + `super_admin` guard + nunca borrar `super_admin` + `permission denied` con mensaje accionable.

## Alternativas descartadas

- Insertar `pending_gmail` sin `auth.users` → viola `FK profiles_id_fkey`.
- Migrar PK al vincular Gmail (`UPDATE profiles.id = auth.uid()`) → huérfanos en `member_payments`/`attendance`.
- Crear función `SECURITY DEFINER` para guardianes en vez de GRANT → más código, mismo efecto; se prefirió GRANT idempotente + fallback `--no-guardian` + creación vía UI.
