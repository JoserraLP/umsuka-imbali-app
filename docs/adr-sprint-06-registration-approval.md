# ADR-006: Sprint 6 — Confirmación de Super Admin en Registro (Registration Approval)

**Status:** Accepted · **Date:** 2026-07-29

---

## Context

Hasta el Sprint 5, cualquier usuario que se registraba con Google OAuth obtenía acceso inmediato a todas las funcionalidades de la aplicación. No existía un paso de verificación por parte de un administrador, lo que implicaba riesgos de seguridad y falta de control sobre quién podía acceder a la plataforma.

Para la Umsuka Imbali App, es necesario que un super admin (o admin) revise y apruebe explícitamente cada nuevo registro antes de que el usuario pueda acceder a cualquier funcionalidad (eventos, turnos, noticias, votaciones, etc.).

## Decisión

Se implementó un flujo de aprobación de registros con las siguientes decisiones arquitectónicas:

### 1. Nuevo tipo ENUM `user_status`

Se creó el tipo `umsuka.user_status` con los valores `'pending'`, `'active'` y `'suspended'` para representar el estado de aprobación de cada perfil. Este nuevo campo es independiente del campo `is_active` existente (que controla el alta/baja de miembros ya activos).

### 2. Columna `status` en `umsuka.profiles`

Se añadió la columna `status` con valor por defecto `'pending'`. Los usuarios existentes se migraron a `'active'` para evitar bloqueos retroactivos.

### 3. Actualización del trigger `handle_new_user()`

El trigger que crea perfiles automáticamente tras el registro con Google OAuth ahora inserta con `status = 'pending'`.

### 4. Capa de defensa en profundidad (tres niveles)

| Nivel | Mecanismo | Archivo |
|-------|-----------|---------|
| RLS | Las políticas de todas las tablas requieren `is_active_member()` (status = 'active' AND is_active = true) | `20260101002700_user_status_rls.sql` |
| Middleware | Redirección a `/auth/pending` si `current_user_status()` retorna 'pending' o 'suspended' | `src/lib/supabase/middleware.ts` |
| Sesión | `getCurrentProfile()` retorna `null` si `status !== 'active'` | `src/lib/auth/session.ts` |

### 5. Página informativa `/auth/pending`

Página pública que muestra un mensaje distinto para usuarios pendientes ("Registro pendiente") y suspendidos ("Cuenta suspendida").

### 6. Panel de administración `/admin/registrations`

Nuevo módulo que lista los usuarios con `status = 'pending'` y permite a administradores (super_admin y admin) aprobar o suspender usuarios mediante botones dedicados.

### 7. Módulo `lib/approvals/`

Contiene los schemas Zod (`approveUserSchema`, `suspendUserSchema`), queries (`listPendingProfiles`) y mutations (`approveUser`, `suspendUser`) con las siguientes características de seguridad:
- Validación de entrada con Zod (UUIDs)
- Autenticación obligatoria (`requireAuthenticatedProfile`)
- Autorización con `requireAdmin` (solo super_admin y admin)
- Uso de `createAdminClient()` para bypass de RLS en las mutaciones (defense-in-depth)
- Prevención de auto-suspensión

### 8. Funciones auxiliares SQL

- `umsuka.is_active_member()`: Retorna true solo si el usuario actual tiene `status = 'active'` y `is_active = true`. Usada en políticas RLS.
- `umsuka.current_user_status()`: Retorna el status como texto para consulta rápida desde middleware.

## Consecuencias

### Positivas
- Control total de acceso: ningún usuario no aprobado puede acceder a funcionalidades
- Defensa en profundidad con tres capas independientes
- Experiencia clara para el usuario (página informativa con estado)
- Panel de administración intuitivo para gestión de aprobaciones
- Compatibilidad hacia atrás: todos los usuarios existentes migrados a `'active'`
- Sin regresiones en módulos existentes (todos los tests pasan)

### Negativas / Riesgos
- Los administradores deben aprobar manualmente cada nuevo registro (posible cuello de botella si hay muchos registros)
- La migración de usuarios existentes a `'active'` es una operación única que debe ejecutarse antes de que la nueva columna entre en vigor
- El campo `is_active` ahora es redundante para el control de acceso (aunque mantiene su semántica original de "baja")

### Técnicas
- Se añadieron 15 nuevos tests unitarios para el módulo de approvals
- Se actualizaron las consultas de `lib/profiles/queries.ts` para incluir `status`
- Se añadió el enlace de navegación "Aprobaciones" visible solo para administradores
- La columna "Registro" en la página de Miembros muestra el status de aprobación

## Archivos Modificados/Creados

| Archivo | Acción |
|---------|--------|
| `supabase/migrations/20260101002600_user_status_enum.sql` | CREATE |
| `supabase/migrations/20260101002700_user_status_rls.sql` | CREATE |
| `src/types/database.types.ts` | MODIFY |
| `src/types/auth.ts` | MODIFY |
| `src/lib/auth/session.ts` | MODIFY |
| `src/lib/profiles/provisioning.ts` | MODIFY |
| `src/lib/supabase/middleware.ts` | MODIFY |
| `src/app/auth/pending/page.tsx` | CREATE |
| `src/lib/approvals/schema.ts` | CREATE |
| `src/lib/approvals/queries.ts` | CREATE |
| `src/lib/approvals/mutations.ts` | CREATE |
| `src/app/admin/registrations/actions.ts` | CREATE |
| `src/app/admin/registrations/page.tsx` | CREATE |
| `src/app/admin/registrations/approve-button.tsx` | CREATE |
| `src/app/admin/registrations/suspend-button.tsx` | CREATE |
| `src/components/layout/nav-links.ts` | MODIFY |
| `src/lib/profiles/queries.ts` | MODIFY |
| `src/app/admin/users/page.tsx` | MODIFY |
| `tests/unit/lib/approvals/schema.test.ts` | CREATE |
| `tests/unit/lib/approvals/mutations.test.ts` | CREATE |
