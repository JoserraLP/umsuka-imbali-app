# ADR-009: Sprint 9 — Validación y Almacenamiento Seguro de Contraseñas (Password Validation & Security)

**Status:** Accepted · **Date:** 2026-07-30

---

## Context

Sprint 7 introdujo cuentas sin correo electrónico (auth_method = `email_alias`), permitiendo que miembros sin email pudieran tener una cuenta con autenticación por usuario/contraseña. Sin embargo, quedaron pendientes funcionalidades críticas de seguridad que Sprint 9 completa:

1. **Sin protección contra fuerza bruta**: No había rate limiting en el login. Un atacante podía probar contraseñas ilimitadamente.
2. **Sin validación de fortaleza de contraseña**: Al crear una cuenta emailless, la contraseña no tenía requisitos mínimos (longitud, complejidad).
3. **Sin flujo de restablecimiento de contraseña**: Si un miembro olvidaba su contraseña, no había un mecanismo automatizado para recuperarla (el super admin debía resetear manualmente desde Supabase Dashboard).
4. **Mensajes de error genéricos**: En fallo de login, el usuario recibía "Usuario o contraseña incorrectos" sin distinción entre cuenta bloqueada, método de autenticación incorrecto, o credenciales inválidas.
5. **Sin rate limiting**: No había registro de intentos fallidos ni bloqueo temporal de cuentas.

## Decisión

Se implementó un módulo completo de seguridad de contraseñas con las siguientes decisiones arquitectónicas:

### 1. Esquema de base de datos — Tabla `password_attempts`

Se creó la tabla `umsuka.password_attempts` para registrar todos los intentos de inicio de sesión, junto con tres funciones RPC SECURITY DEFINER:

| Recurso | Propósito |
|---------|-----------|
| `password_attempts` (tabla) | Registro de intentos de login con `profile_id`, `success`, `ip_address`, `created_at` |
| `is_login_blocked()` (RPC) | Verifica si un perfil superó `p_max_attempts` fallos en `p_window_minutes` minutos; el bloqueo dura `p_block_minutes` desde el último fallo |
| `record_login_attempt()` (RPC) | Inserta una fila en `password_attempts` (éxito o fallo) |
| `cleanup_old_password_attempts()` (RPC) | Mantenimiento: elimina intentos más antiguos que `p_retention_days` (default 90) |

```
┌────────────────────────────────────────────────────────────────┐
│  Parámetros de rate limiting (configurables vía RPC):           │
│                                                                  │
│  MAX_ATTEMPTS   = 5   intentos fallidos                         │
│  WINDOW_MINUTES = 15  minutos (ventana de conteo)               │
│  BLOCK_MINUTES  = 30  minutos (duración del bloqueo)            │
└────────────────────────────────────────────────────────────────┘
```

### 2. Esquema de base de datos — Tabla `password_reset_tokens`

Se creó la tabla `umsuka.password_reset_tokens` para gestionar tokens de un solo uso (one-time) para restablecimiento de contraseña:

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | `uuid PK` | Identificador único |
| `profile_id` | `uuid FK → profiles` | Perfil destino del reset |
| `token_hash` | `text UNIQUE` | SHA-256 del token raw (nunca se almacena el token en texto plano) |
| `expires_at` | `timestamptz` | Expiración del token (24h desde creación) |
| `used` | `boolean DEFAULT false` | Marca de consumo |
| `used_at` | `timestamptz` | Timestamp de consumo |
| `created_by` | `uuid FK → profiles` | Super admin que generó el token |

**Función atómica `consume_password_reset_token(p_token_hash)`**: Ejecuta un `UPDATE ... WHERE used = false AND expires_at > now()` y retorna el `profile_id`. Si dos llamadas concurrentes intentan consumir el mismo token, solo una tendrá éxito porque el `UPDATE` bloquea la fila a nivel de registro.

### 3. Validación Zod de fortaleza de contraseña (`passwordStrengthSchema`)

Se creó un schema Zod reutilizable que exige:

| Regla | RegExp | Mensaje |
|-------|--------|---------|
| Mínimo 8 caracteres | `.min(8)` | "La contraseña debe tener al menos 8 caracteres." |
| Máximo 100 caracteres | `.max(100)` | "La contraseña debe tener 100 caracteres o menos." |
| Al menos 1 mayúscula | `/[A-Z]/` | "La contraseña debe contener al menos una mayúscula." |
| Al menos 1 minúscula | `/[a-z]/` | "La contraseña debe contener al menos una minúscula." |
| Al menos 1 dígito | `/[0-9]/` | "La contraseña debe contener al menos un número." |
| Al menos 1 carácter especial | `/[^a-zA-Z0-9]/` | "La contraseña debe contener al menos un carácter especial." |

Este schema se integró en `createEmaillessAccountSchema` (Sprint 7) reemplazando `z.string().min(1)`, y también se usa en `resetPasswordSchema` y `changePasswordSchema`.

### 4. Servicio de autenticación con rate limiting (`loginWithPassword`)

El flujo de login se rediseñó como un proceso de **tres pasos** con verificación del lado del servidor:

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│  Login Form   │     │  Server Actions      │     │  Supabase        │
│  (client)     │     │  (actions.ts)        │     │  (Auth + DB)     │
├──────────────┤     ├─────────────────────┤     ├──────────────────┤
│ 1. Username  │────>│ 2. resolveUsername-  │     │                  │
│    + Password │     │    ForLogin()        │────>│ 3. SELECT        │
│              │     │    → email alias      │<────│    profile +     │
│              │     │                      │     │    email_aliases │
│              │     │ 4. loginAction()     │────>│ 5. is_login_     │
│              │     │    → loginWith-      │     │    blocked()     │
│              │     │    Password()        │<────│ 6. Bloqueado?    │
│              │     │                      │────>│ 7. signInWith-   │
│              │     │                      │     │    Password()    │
│              │     │                      │────>│ 8. record_login- │
│              │     │                      │     │    attempt()     │
│              │<────│ 9. Result con        │     │                  │
│              │     │    errorCode         │     │                  │
│              │     │                      │     │                  │
│ 10. signIn-  │────>│──────────────────────│────>│ 11. Establece    │
│     With-    │     │                      │     │     sesión       │
│     Password │     │                      │     │     (cookie)     │
│ 12. Redirect │     │                      │     │                  │
└──────────────┘     └─────────────────────┘     └──────────────────┘
```

**Detalles del flujo:**

1. **Cliente** envía username + password a `resolveUsernameForLogin()` (server action).
2. **Servidor** resuelve username → email alias (usando admin client).
3. **Servidor** llama a `loginWithPassword()` que:
   - a. Valida input con Zod.
   - b. Resuelve username → profile + email alias.
   - c. Verifica rate limiting vía `is_login_blocked()` RPC.
   - d. Intenta `admin.auth.signInWithPassword(alias, password)`.
   - e. Registra el intento vía `record_login_attempt()` RPC.
   - f. Si después del intento fallido se alcanzó el límite, verifica bloqueo.
   - g. Retorna resultado con `errorCode` específico.
4. **Cliente** (si éxito en servidor) ejecuta `supabase.auth.signInWithPassword()` para establecer la cookie de sesión en el navegador.
5. **Redirección** completa (window.location.href) para refrescar el estado del middleware.

### 5. Error codes específicos

| errorCode | Condición | Mensaje al usuario |
|-----------|-----------|-------------------|
| `invalid_credentials` | Contraseña incorrecta | "Usuario o contraseña incorrectos." |
| `account_locked` | 5+ fallos en 15 min | "Demasiados intentos fallidos. La cuenta estará bloqueada hasta las {hora}." |
| `account_not_found` | Username no existe | "Usuario no encontrado." |
| `wrong_auth_method` | La cuenta usa Google OAuth | "Este usuario no utiliza autenticación por usuario/contraseña." |

### 6. Generación de tokens de restablecimiento (solo super_admin)

`generateResetToken()` en `password-service.ts`:

1. Verifica que el actor sea `super_admin`.
2. Genera `rawToken = crypto.randomUUID()` (formato UUID v4).
3. Calcula `tokenHash = await sha256(rawToken)` usando Web Crypto API.
4. Almacena solo el hash en la BD (nunca el raw token).
5. Retorna el raw token al admin para que lo comparta con el usuario.

```
                        ┌──────────────────┐
                        │  Super Admin      │
                        │  genera token     │
                        └────────┬─────────┘
                                 │
                                 ▼
               ┌──────────────────────────────────┐
               │  password-service.ts              │
               │  1. crypto.randomUUID() → raw     │
               │  2. SHA-256(raw) → hash           │
               │  3. INSERT (hash, expires_at)     │
               │  4. Return raw token to admin     │
               └──────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
        ┌─────────────────────┐   ┌──────────────────────┐
        │  password_reset_    │   │  Admin muestra link  │
        │  tokens (solo hash) │   │  raw al usuario      │
        └─────────────────────┘   └──────────────────────┘
```

### 7. Consumo atómico de tokens

`consume_password_reset_token(p_token_hash)` es una función PL/pgSQL que:

1. Ejecuta `UPDATE ... SET used = true, used_at = now() WHERE token_hash = p_token_hash AND used = false AND expires_at > now()`.
2. Retorna el `profile_id` mediante `RETURNING`.
3. Si el `UPDATE` no afecta ninguna fila (token inválido, ya usado, o expirado), retorna NULL.

Esto es **atómico**: el UPDATE bloquea la fila a nivel de registro, previniendo condiciones de carrera donde dos solicitudes intenten consumir el mismo token simultáneamente.

### 8. Cambio de contraseña autenticado (`changePassword`)

`changePassword()` permite al usuario cambiar su contraseña actual:

1. Verifica la identidad del usuario vía `requireAuthenticatedProfile()`.
2. Obtiene el email alias desde `email_aliases`.
3. Verifica la contraseña actual con `admin.auth.signInWithPassword()`.
4. Si es correcta, actualiza con `admin.auth.admin.updateUserById()`.

### 9. Refactor del formulario de login

`username-login-form.tsx` se refactorizó para:

- Usar `loginAction()` (server action) en lugar de resolver + signIn directo.
- Mostrar errores específicos según `errorCode`.
- Mostrar mensaje contextual cuando `errorCode === "account_locked"`.
- Prevenir doble envío con `hasStartedRef`.

### 10. Componente admin `ResetPasswordButton`

Añadido a la página de administración de usuarios (`/admin/users/page.tsx`):

- Botón "Restablecer contraseña" visible solo para cuentas `email_alias` y que no sean el propio admin.
- Al hacer clic, genera un token y muestra el enlace completo (`{origin}/auth/reset-password?token={token}`).
- Botón "Copiar enlace" que usa `navigator.clipboard.writeText()`.
- Mensaje: "Entrega este enlace al usuario. No podrás volver a verlo."
- El token expira en 24 horas y es de un solo uso.

### 11. Página `/auth/reset-password`

- Server component que recibe `token` como search param.
- Valida formato UUID en servidor antes de renderizar el formulario.
- Formulario cliente (`ResetPasswordForm`) con campos de nueva contraseña + confirmación.
- Envía a `resetPasswordAction()` → `resetPassword()` que consume el token y actualiza la contraseña.
- En éxito, muestra pantalla de confirmación con botón "Iniciar sesión".

### 12. Integración con esquema de creación de cuentas

`createEmaillessAccountSchema` se actualizó para usar `passwordStrengthSchema` en lugar de `z.string().min(1)`, asegurando que todas las contraseñas nuevas cumplan con los requisitos de fortaleza.

## Arquitectura

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Frontend (Client Components)                                            │
│  ┌──────────────────┐  ┌─────────────────────┐  ┌────────────────────┐  │
│  │ UsernameLoginForm │  │ ResetPasswordForm    │  │ ResetPassword-    │  │
│  │ (login page)      │  │ (/auth/reset-password)│  │ Button (admin)   │  │
│  └────────┬─────────┘  └──────────┬──────────┘  └────────┬───────────┘  │
│           │                       │                       │              │
└───────────┼───────────────────────┼───────────────────────┼──────────────┘
            │                       │                       │
┌───────────┼───────────────────────┼───────────────────────┼──────────────┐
│  Server Actions ("use server")    │                       │              │
│           │                       │                       │              │
│  ┌────────▼───────────────────────▼───────────────────────▼──────────┐  │
│  │  actions.ts (login)           actions.ts (reset-password)         │  │
│  │  actions.ts (admin/users)                                         │  │
│  │  (thin wrappers, delegate to services + revalidatePath)           │  │
│  └────────┬──────────────────────────────────────────────────────────┘  │
│           │                                                             │
└───────────┼─────────────────────────────────────────────────────────────┘
            │
┌───────────▼─────────────────────────────────────────────────────────────┐
│  Service Layer (server-only modules)                                     │
│  ┌──────────────────────┐  ┌──────────────────────────────────────────┐ │
│  │ password-service.ts  │  │ password-schema.ts                       │ │
│  │ - loginWithPassword  │  │ - passwordStrengthSchema                 │ │
│  │ - generateResetToken │  │ - loginSchema                            │ │
│  │ - resetPassword      │  │ - resetPasswordSchema                    │ │
│  │ - changePassword     │  │ - changePasswordSchema                   │ │
│  │                      │  │ - generateResetTokenSchema               │ │
│  └──────────┬───────────┘  └──────────────────────────────────────────┘ │
│             │                                                           │
└─────────────┼───────────────────────────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────────────────────────────┐
│  Supabase (admin client - service_role)                                 │
│  ┌──────────────────────────┐  ┌─────────────────────────────────────┐ │
│  │ password_attempts (tabla)│  │ password_reset_tokens (tabla)        │ │
│  │ - is_login_blocked (RPC) │  │ - consume_password_reset_token(RPC) │ │
│  │ - record_login_attempt   │  │ - cleanup_expired_... (RPC)         │ │
│  │ - cleanup_old_... (RPC)  │  │                                      │ │
│  └──────────────────────────┘  └─────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │ Supabase Auth (admin API)                                        │ │
│  │ - admin.auth.signInWithPassword()  (verificación)                │ │
│  │ - admin.auth.admin.updateUserById() (cambio de contraseña)       │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

## Security Considerations

### 1. Protección contra fuerza bruta (defensa en profundidad)

El rate limiting opera a nivel de base de datos con funciones SECURITY DEFINER, lo que significa que:
- La lógica de bloqueo no puede ser evadida aunque se llame desde otro contexto.
- Los parámetros (5 intentos, 15 min ventana, 30 min bloqueo) son configurables vía argumentos de la RPC.
- El bloqueo se calcula desde el último intento fallido, no desde el primero, lo que extiende el bloqueo si el atacante sigue intentando.

### 2. Token security (one-time, SHA-256 hashed)

- `rawToken = crypto.randomUUID()` — 122 bits de entropía, impredecible.
- Solo el hash SHA-256 se almacena en la base de datos.
- El raw token se muestra **una sola vez** al admin que lo genera.
- El token expira a las 24 horas.
- El consumo es atómico vía UPDATE con condiciones — previene race conditions.

### 3. Atomicidad en consumo de tokens

La función `consume_password_reset_token()` ejecuta:
```sql
update umsuka.password_reset_tokens
set used = true, used_at = now()
where token_hash = p_token_hash
  and used = false
  and expires_at > now()
returning profile_id;
```

El UPDATE bloquea la fila a nivel de registro en PostgreSQL. Si dos solicitudes concurrentes intentan consumir el mismo token, solo la primera verá afectada una fila y obtendrá un `profile_id`; la segunda obtendrá `NULL`.

### 4. Server-only para código sensible

Todos los módulos que manejan contraseñas o tokens usan `import "server-only"` para garantizar que nunca sean incluidos en el bundle del cliente.

| Módulo | `server-only` |
|--------|---------------|
| `password-service.ts` | Sí |
| `emailless-login.ts` | Sí |

### 5. Uso de admin client (service role)

`loginWithPassword()` usa `createAdminClient()` para:
- Consultar `profiles` y `email_aliases` (tablas con RLS estricto).
- Llamar a funciones RPC SECURITY DEFINER.
- Intentar `signInWithPassword()` con el email alias interno.

El service role key nunca se expone al bundle del cliente porque `loginWithPassword()` solo se llama desde server actions.

### 6. Mensajes de error controlados

Los mensajes de error son informativos pero no revelan información sensible:
- `invalid_credentials`: mensaje genérico "Usuario o contraseña incorrectos."
- `account_locked`: indica hora de desbloqueo pero no confirma que el usuario exista (se llega a este estado solo tras 5 intentos fallidos, lo que ya confirmó que la cuenta existe).
- `account_not_found`: mensaje "Usuario no encontrado."
- `wrong_auth_method`: mensaje para cuentas que no usan autenticación por contraseña.

### 7. Validación de fortaleza en creación y cambio

`passwordStrengthSchema` se aplica en:
- Creación de cuenta (`createEmaillessAccountSchema`).
- Restablecimiento de contraseña (`resetPasswordSchema`).
- Cambio de contraseña autogestionado (`changePasswordSchema`).

Esto asegura que nunca se almacene una contraseña débil en Supabase Auth.

## Edge cases manejados

### Rate limiting

| Escenario | Comportamiento |
|-----------|----------------|
| 4 intentos fallidos seguidos | 5º intento: se registra fallo + se verifica bloqueo → `account_locked` |
| 2 fallos → 1 éxito → 3 fallos | 3 fallos después del éxito no son suficientes para bloquear (ventana de 15 min resetea parcialmente) |
| Bloqueo activo → intento durante bloqueo | Rechazado inmediatamente sin contar como intento adicional |
| Bloqueo expirado → nuevo intento | Se permite el intento, el contador arranca de nuevo |
| `is_login_blocked()` sin fallos recientes | Retorna `false` (no bloqueado) |
| Perfil sin intentos registrados | Retorna `false` (no bloqueado) |

### Token de restablecimiento

| Escenario | Comportamiento |
|-----------|----------------|
| Token válido, no usado, no expirado | Consumo exitoso → contraseña actualizada |
| Token ya usado | `consume_password_reset_token()` retorna NULL → error "Token inválido o expirado." |
| Token expirado | Misma condición `expires_at > now()` → NULL |
| Token inexistente | `UPDATE` afecta 0 filas → NULL |
| Dos solicitudes simultáneas con mismo token | Atomicidad: solo una consume el token; la segunda recibe NULL |
| UUID inválido como token | `resetPasswordSchema` rechaza con "Token inválido." |

### Login flow

| Escenario | Comportamiento |
|-----------|----------------|
| Username vacío | `loginSchema` rechaza (Zod) → `invalid_credentials` |
| Username no existe | `account_not_found` |
| Cuenta Google OAuth intenta login con username | `wrong_auth_method` |
| Contraseña incorrecta (primer intento) | `invalid_credentials` |
| Contraseña incorrecta (quinto intento en ventana) | `account_locked` con `blockedUntil` timestamp |
| Red temporaria (error de red) | Error de Supabase propagado con mensaje |
| Doble clic en botón de login | `hasStartedRef` previene doble envío |

## Tests (269 tests nuevos)

### `password-schema.test.ts` — 29 tests

Suite | Tests | Cobertura
------|-------|----------
`passwordStrengthSchema` | 9 | Acepta contraseña fuerte; rechaza sin mayúscula, sin minúscula, sin dígito, sin especial, < 8 chars, > 100 chars; acepta varios especiales; acepta exactamente 8 chars con todos los requisitos |
`loginSchema` | 5 | Acepta válido; rechaza username vacío; rechaza password vacío; trimea username; no trimea password |
`resetPasswordSchema` | 5 | Acepta válido; rechaza token no-UUID; rechaza contraseña débil; rechaza contraseñas no coincidentes |
`changePasswordSchema` | 4 | Acepta válido; rechaza currentPassword vacío; rechaza contraseña débil; rechaza no coincidentes |
`generateResetTokenSchema` | 3 | Acepta UUID válido; rechaza no-UUID; rechaza vacío |

## Consecuencias

### Positivas
- Protección completa contra fuerza bruta con rate limiting configurable a nivel de base de datos.
- Contraseñas fuertes garantizadas desde la creación de la cuenta.
- Flujo completo de restablecimiento de contraseña administrado por super_admin, sin necesidad de acceso directo a Supabase Dashboard.
- Tokens de un solo uso con hash SHA-256 — ni siquiera el super admin puede reutilizar un token después de generado.
- Consumo atómico de tokens — previene condiciones de carrera.
- Mensajes de error específicos que mejoran la UX sin comprometer la seguridad.
- El cambio de contraseña autogestionado verifica la contraseña actual antes de permitir el cambio.
- Server-only previene ejecución de código sensible en el cliente.
- 29 nuevos tests unitarios con 0 regresiones.

### Negativas / Riesgos
- El flujo de restablecimiento depende del super admin para generar el token — no es un flujo autoservice (no hay email para enviar el enlace automáticamente).
- El token raw se muestra en el frontend del admin y debe ser copiado y compartido por un canal externo (presencial, teléfono, etc.) — riesgo de interceptación si el canal no es seguro.
- No hay notificación al miembro cuando su contraseña es restablecida por un admin (no hay email asociado a la cuenta).
- El rate limiting es por perfil (profile_id), no por IP — un atacante con múltiples credenciales comprometidas no sería bloqueado por IP.
- La función `cleanup_old_password_attempts` y `cleanup_expired_reset_tokens` son RPCs de mantenimiento que deben ejecutarse periódicamente (vía cron o manualmente) — no hay schedule automático.

### Técnicas
- Se crearon dos nuevas tablas en el schema `umsuka`: `password_attempts` y `password_reset_tokens`.
- Se añadieron 6 nuevas funciones RPC SECURITY DEFINER (4 para rate limiting, 2 para mantenimiento de tokens).
- Se integró `passwordStrengthSchema` en el esquema de creación de cuentas existente (`createEmaillessAccountSchema`).
- Se añadió `errorCode` a los tipos de retorno de `emailless-schema.ts` y `emailless-login.ts` para propagar códigos de error específicos.
- Los índices en `password_attempts(profile_id, created_at desc)` y `password_reset_tokens(token_hash)` optimizan las consultas de rate limiting y consumo de tokens.
- Se actualizó `src/lib/profiles/queries.ts` para incluir `auth_method` y `username` en las consultas de listado de usuarios.
- Se añadió la función helper `sha256()` usando Web Crypto API (disponible en Node 18+ y entornos modernos).

## Archivos Modificados/Creados

| Archivo | Acción |
|---------|--------|
| `supabase/migrations/20260101003400_password_attempts.sql` | CREATE |
| `supabase/migrations/20260101003500_password_reset_tokens.sql` | CREATE |
| `src/lib/auth/password-schema.ts` | CREATE |
| `src/lib/auth/password-service.ts` | CREATE |
| `src/app/auth/reset-password/page.tsx` | CREATE |
| `src/app/auth/reset-password/reset-password-form.tsx` | CREATE |
| `src/app/auth/reset-password/actions.ts` | CREATE |
| `src/app/admin/users/reset-password-button.tsx` | CREATE |
| `tests/unit/lib/password-schema.test.ts` | CREATE |
| `src/lib/auth/emailless-schema.ts` | MODIFY — added `errorCode` to `ResolveUsernameResult` |
| `src/lib/auth/emailless-login.ts` | MODIFY — propagate `errorCode` |
| `src/app/auth/login/actions.ts` | MODIFY — added `loginAction` |
| `src/app/auth/login/username-login-form.tsx` | MODIFY — refactored for server-side verification |
| `src/app/admin/users/actions.ts` | MODIFY — added `generateResetTokenAction` |
| `src/app/admin/users/page.tsx` | MODIFY — added `ResetPasswordButton` |
| `src/lib/profiles/queries.ts` | MODIFY — added `auth_method` and `username` fields |
| `tests/unit/lib/emailless-schema.test.ts` | MODIFY — updated with strong passwords |
