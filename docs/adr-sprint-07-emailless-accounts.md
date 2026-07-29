# ADR-007: Sprint 7 — Creación de Cuentas sin Correo Electrónico (Emailless Accounts)

**Status:** Accepted · **Date:** 2026-07-29

---

## Context

La Umsuka Imbali App requiere manejar miembros que no poseen una dirección de correo electrónico — por ejemplo, menores de edad que participan en danza o música. Hasta el Sprint 6, el único método de autenticación era Google OAuth, lo que impedía que estos miembros tuvieran una cuenta.

Se necesitaba un mecanismo que:

- Permitiera al super admin crear cuentas para miembros sin email.
- Fuera compatible con Supabase Auth, cuyo `signInWithPassword()` requiere un email.
- No expusiera el email interno generado a ningún usuario (ni siquiera al dueño de la cuenta).
- Soportara cambio de contraseña autogestionado por el miembro.
- Se integrara con el flujo de aprobación de registros (Sprint 6) — las cuentas se crean en estado `pending`.

## Decisión

### Estrategia A (elegida): Alias de email autogenerado + login con usuario/contraseña

Se descartó la **Estrategia B** (usar el teléfono como identificador alternativo) porque:
- Supabase Auth no soporta natively `signInWithPassword()` con teléfono sin configuración adicional de Phone Auth.
- El alias de email (`user-{uuid}@umsuka.internal`) es completamente interno y no requiere verificación.
- La compatibilidad con el flujo existente de Supabase Auth se mantiene intacta.

### Arquitectura general

```
┌─────────────────────────────────────────────────────────────────────┐
│  Super Admin (creates account)                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  1. Fill form (name, username, password, component, group)   │   │
│  │  2. Server action → createEmaillessAccount()                  │   │
│  │  3. System generates: user-{uuid}@umsuka.internal            │   │
│  │  4. Auth user created with alias + password (auto-confirmed) │   │
│  │  5. Profile row created (auth_method = 'email_alias')        │   │
│  │  6. Email alias recorded in umsuka.email_aliases              │   │
│  │  7. Credentials shown ONCE to admin (never stored again)     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Member (logs in)                                                   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  1. Enters username + password on login page                 │   │
│  │  2. Server action: resolveUsernameToEmail(username)          │   │
│  │     → returns email_alias                                    │   │
│  │  3. Client-side: supabase.auth.signInWithPassword(alias, pw) │   │
│  │  4. Session established normally                             │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Decisiones arquitectónicas clave

#### 1. Resolución username → email alias vía server action (no directa)

El login sigue un **proceso de dos pasos**:

1. **Server action** (`resolveUsernameForLogin`): El username se resuelve al email alias interno usando el admin client (service role key). Esto es necesario porque la tabla `email_aliases` tiene RLS que solo permite acceso `is_super_admin()`, y la página de login es pre-autenticación (no hay sesión de usuario contra la cual evaluar RLS).

2. **Cliente-side** (`signInWithPassword`): La función `signInWithPassword()` de Supabase debe ejecutarse desde el navegador (cliente de Supabase del lado del cliente) para que pueda almacenar correctamente la cookie de sesión en el browser.

#### 2. Admin client para resolución pública

`resolveUsernameToEmail()` usa `createAdminClient()` (service role key) para consultar `profiles` y `email_aliases`. Aunque es una función llamada desde un server action público (sin autenticación), el uso del admin client es intencional:
- No hay sesión de usuario en la página de login.
- La tabla `email_aliases` solo permite acceso a `is_super_admin()` vía RLS.
- La resolución es una operación interna del servidor, no expuesta vía API pública.

#### 3. Rollback en cascada

Si cualquier paso falla después de crear el Auth user, se revierten las mutaciones anteriores para evitar registros huérfanos:

| Paso | Si falla... | Rollback |
|------|-------------|----------|
| 1. Crear Auth user | Se retorna error inmediatamente | N/A |
| 2. Insertar profile | Se elimina el Auth user | `admin.auth.admin.deleteUser()` |
| 3. Insertar email_aliases | Se elimina profile + Auth user | `admin.from("profiles").delete()` + `deleteUser()` |

#### 4. Email nunca expuesto

`buildAuthenticatedProfile()` en `session.ts` establece `email: null` cuando `auth_method === "email_alias"`. Esto asegura que el alias interno `user-{uuid}@umsuka.internal` nunca sea renderizado en UI, devuelto en APIs, ni accesible por ningún usuario.

#### 5. Cuentas creadas en estado `pending`

Las nuevas cuentas se crean con `status: "pending"`, integrándose con el flujo de aprobación del Sprint 6. Un administrador debe aprobar la cuenta antes de que el miembro pueda acceder.

#### 6. Cambio de contraseña autogestionado

Los miembros con `auth_method === "email_alias"` ven una tarjeta adicional "Contraseña" en su perfil con un formulario de cambio de contraseña que usa `supabase.auth.updateUser({ password })`.

### Formato del alias de email

```
user-{uuid}@umsuka.internal

Ejemplo: user-550e8400-e29b-41d4-a716-446655440000@umsuka.internal
```

- Usa `crypto.randomUUID()` — garantiza unicidad global.
- No contiene información personal (nombres, fechas, números secuenciales).
- El dominio `umsuka.internal` no es enrutable (no existe en DNS).

### Data model — nuevas columnas y tablas

```
umsuka.auth_method (ENUM): 'google' | 'email_alias' | 'phone'

umsuka.profiles
  + auth_method  umsuka.auth_method  NOT NULL  DEFAULT 'google'
  + username     text                UNIQUE

umsuka.email_aliases
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
  profile_id  uuid NOT NULL REFERENCES umsuka.profiles(id) ON DELETE CASCADE
  alias_email text NOT NULL UNIQUE  -- user-{uuid}@umsuka.internal
  created_by  uuid REFERENCES umsuka.profiles(id)
  created_at  timestamptz NOT NULL DEFAULT now()
```

### Flujo de login detallado

```
┌──────────────┐     ┌───────────────────┐     ┌──────────────────┐
│  Login Page   │     │  Server Action     │     │  Supabase Auth   │
│  (client)     │     │  resolveUsername-  │     │  (client-side)   │
│              │     │  ForLogin()        │     │                  │
├──────────────┤     ├───────────────────┤     ├──────────────────┤
│ 1. Username  │────>│ 2. Busca profile  │     │                  │
│    + Password │     │    por username    │     │                  │
│              │     │ 3. Verifica        │     │                  │
│              │     │    auth_method =    │     │                  │
│              │     │    'email_alias'    │     │                  │
│              │     │ 4. Obtiene alias   │     │                  │
│              │     │    de email_aliases │     │                  │
│              │<────│ 5. Retorna alias   │     │                  │
│              │     │                    │     │                  │
│ 6. signInWith│─────│───────────────────>│     │ 7. Login OK      │
│    Password( │     │                    │     │                  │
│    alias, pw)│     │                    │     │                  │
│              │<────│───────────────────│     │ 8. Session cookie│
│ 9. Redirect  │     │                    │     │                  │
│    to /dashboard   │                    │     │                  │
└──────────────┘     └───────────────────┘     └──────────────────┘
```

## Consecuencias

### Positivas
- Membresía inclusiva para menores y miembros sin email.
- Compatibilidad total con Supabase Auth (usa email/password internamente).
- El email alias nunca se expone a ningún usuario (seguridad por diseño).
- Rollback automático ante fallos — no quedan registros huérfanos.
- Integración con el sistema de aprobación de registros (Sprint 6).
- Cambio de contraseña autogestionado sin intervención del admin.
- Namespace de usuario único (username UNIQUE + indexado).
- 20 nuevos tests unitarios (12 para schema de creación, 4 para schema de resolución, 4 para formato de alias).

### Negativas / Riesgos
- El super admin debe compartir las credenciales en texto plano inmediatamente después de crear la cuenta (la contraseña no se almacena en ningún lado después de la creación).
- El formulario de creación muestra la contraseña en texto plano en el frontend — riesgo de shoulder-surfing si el admin no es cuidadoso.
- No hay recuperación de contraseña (no hay email para enviar reset password). Si un miembro olvida su contraseña, el super admin debe crear una nueva cuenta o resetear manualmente desde Supabase Dashboard.
- El username debe ser único globalmente — puede haber conflictos si no se elige cuidadosamente.

### Técnicas
- Se añadió un nuevo tipo ENUM `umsuka.auth_method` con valores `'google'`, `'email_alias'`, `'phone'`.
- Se añadieron dos nuevas columnas (`auth_method`, `username`) a `umsuka.profiles`.
- Se creó la tabla `umsuka.email_aliases` con RLS estricto (solo super_admin).
- Se actualizó `handle_new_user()` trigger para insertar con `auth_method = 'google'`.
- Se actualizó `ensureProfileExists()` (provisioning) para incluir `auth_method: 'google'`.
- La página de login ahora tiene un tab switcher (Google / Usuario) manejado por `LoginTabs`.
- Se añadió navegación por teclado y atributos `role="tablist"` / `role="tab"` para accesibilidad.

## Security Considerations

### 1. Protección del email alias
- El alias interno (`user-{uuid}@umsuka.internal`) nunca se devuelve al frontend.
- `buildAuthenticatedProfile()` explícitamente setea `email: null` para cuentas `email_alias`.
- La tabla `email_aliases` tiene RLS que solo permite operaciones a `is_super_admin()`.
- La resolución username → alias solo es posible vía server action (no hay API pública directa).

### 2. Uso del admin client
- `resolveUsernameToEmail()` usa `createAdminClient()` (service role key) porque se ejecuta en un contexto pre-autenticación.
- Esto es seguro porque la función se ejecuta exclusivamente en el servidor (Next.js server action), nunca en el cliente.
- El service role key nunca se expone al bundle del cliente.

### 3. Rollback de seguridad
- Si la inserción del profile falla, el Auth user se elimina — no hay cuentas Auth huérfanas.
- Si la inserción del alias falla, tanto el profile como el Auth user se eliminan.
- El catch silencioso (`.catch(() => {})`) en los rollbacks evita que errores secundarios enmascaren el error original.

### 4. Cuentas pending por defecto
- Las cuentas se crean con `status: "pending"`, requiriendo aprobación administrativa antes del primer acceso.
- Esto evita que un miembro creado por error o maliciosamente pueda acceder inmediatamente.

### 5. Namespace de usuarios
- `username` tiene una constraint UNIQUE a nivel de base de datos, previniendo duplicados.
- El alias de email usa `crypto.randomUUID()` — sin colisiones posibles.
- El alias no contiene información personal identificable.

## Archivos Modificados/Creados

| Archivo | Acción |
|---------|--------|
| `supabase/migrations/20260101002800_auth_method_enum.sql` | CREATE |
| `supabase/migrations/20260101002900_email_aliases_rls.sql` | CREATE |
| `src/types/database.types.ts` | MODIFY |
| `src/types/auth.ts` | MODIFY |
| `src/lib/auth/session.ts` | MODIFY |
| `src/lib/profiles/provisioning.ts` | MODIFY |
| `src/lib/auth/emailless-schema.ts` | CREATE |
| `src/lib/auth/admin-create.ts` | CREATE |
| `src/lib/auth/emailless-login.ts` | CREATE |
| `src/app/auth/login/actions.ts` | CREATE |
| `src/app/auth/login/login-tabs.tsx` | CREATE |
| `src/app/auth/login/username-login-form.tsx` | CREATE |
| `src/app/auth/login/page.tsx` | MODIFY |
| `src/app/admin/users/actions.ts` | MODIFY |
| `src/app/admin/users/emailless-account-form.tsx` | CREATE |
| `src/app/admin/users/page.tsx` | MODIFY |
| `src/app/profile/change-password-form.tsx` | CREATE |
| `src/app/profile/page.tsx` | MODIFY |
| `tests/unit/lib/emailless-schema.test.ts` | CREATE |
| `tests/unit/lib/admin-create.test.ts` | CREATE |
