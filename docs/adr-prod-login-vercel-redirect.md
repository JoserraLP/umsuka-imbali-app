# ADR-011: Bugfix — Login desde producción redirige al login de Vercel

**Status:** Accepted · **Date:** 2026-07-31

---

## Contexto

Los usuarios que intentaban iniciar sesión con Google OAuth desde el
despliegue de producción de la Umsuka Imbali App terminaban en la página de
login de Vercel (Vercel Authentication / Deployment Protection) en lugar de
completar la autenticación en la app. El flujo se interrumpía antes de que la
aplicación siquiera cargara.

Dos factores contribuyentes:

### 1. Vercel "Deployment Protection" intercepta todas las peticiones

Vercel Authentication (Deployment Protection) intercepta **todas** las
peticiones en los deployments protegidos — incluyendo `/auth/callback` y
`/auth/login` — mostrando un login con la marca de Vercel antes de que la app
cargue. Esta configuración opera a nivel de plataforma y no estaba
documentada como requisito para producción.

### 2. `getCallbackOrigin()` no priorizaba el dominio canónico

`getCallbackOrigin()` en `src/components/layout/google-signin-button.tsx`
prefería `window.location.origin` (el hostname desde el que navega el usuario)
sobre el `NEXT_PUBLIC_SITE_URL` canónico al construir la URL `redirectTo` del
OAuth. En producción, el callback podía depender del hostname concreto que el
usuario estuviera navegando (p. ej. un alias `*.vercel.app`). Si esa URL
exacta no está en la allowlist de "Redirect URLs" de Supabase, Supabase
**falla silenciosamente** a su Site URL configurada, enviando el flujo al
lugar equivocado.

Adicionalmente, el middleware tenía un hueco en la misma familia de flujos de
autenticación: `PUBLIC_ROUTES` no incluía `/auth/reset-password`, por lo que
un usuario sin sesión con un token de reset era rebotado a `/auth/login`,
rompiendo el flujo de restablecimiento de contraseña.

---

## Decisión

Se hicieron tres cambios:

### 1. Origen canónico del callback OAuth

`getCallbackOrigin()` ahora retorna el origen de `NEXT_PUBLIC_SITE_URL`
(dominio canónico) **primero**, siempre que la variable esté definida, se
parsee como URL válida, use esquema `http`/`https` y **no** apunte a
localhost (`localhost`, `127.0.0.1`, `0.0.0.0`). Si alguna condición falla,
cae a `window.location.origin` (dev local / previews) y, como red de
seguridad para SSR, a `http://localhost:3000`.

```ts
function getCallbackOrigin(): string {
  const envSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  // 1) Canonical site URL — the domain registered in Supabase's Redirect
  //    URL allowlist. Preferred over the browsing origin so the OAuth
  //    callback never depends on which hostname (alias, preview, etc.)
  //    the user happens to be on.
  if (envSiteUrl) {
    try {
      const parsed = new URL(envSiteUrl);
      const isLocalhost =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "0.0.0.0";
      const isHttpScheme = parsed.protocol === "http:" || parsed.protocol === "https:";
      if (isHttpScheme && !isLocalhost) {
        return parsed.origin;
      }
    } catch {
      // invalid env URL — fall through
    }
  }
  // 2) Fallback: actual browsing origin (local dev, previews).
  try {
    return window.location.origin;
  } catch {
    // SSR safety net.
    return "http://localhost:3000";
  }
}
```

Esto fija el callback al dominio que ops registra en la allowlist de Supabase,
independientemente del hostname desde el que navegue el usuario.

### 2. Documentación

- `docs/DEPLOYMENT.md` — nueva sección "Vercel Authentication (Deployment
  Protection)" que describe el síntoma (login con la marca de Vercel en
  producción / callback que aterriza en el login de Vercel) y el fix desde el
  dashboard (deshabilitar o limitar Vercel Authentication para producción;
  los previews quedan protegidos por defecto).
- `docs/ENVIRONMENT.md` — se clarifica que `NEXT_PUBLIC_SITE_URL` **debe** ser
  el dominio canónico de producción y **debe** estar en la allowlist de
  Redirect URLs de Supabase.
- `src/app/auth/auth-code-error/page.tsx` — el mensaje para `missing_code`
  ahora sugiere verificar la Deployment Protection de Vercel (Vercel →
  Proyecto → Settings → Deployment Protection) además de la allowlist de
  Supabase.

### 3. Middleware: `/auth/reset-password` como ruta pública

`/auth/reset-password` se añadió a `PUBLIC_ROUTES` en
`src/lib/supabase/middleware.ts`, de modo que un usuario sin sesión con un
token de reset pueda llegar a la página sin ser rebotado a `/auth/login`.

Es seguro porque:

- La página valida la presencia del token y su formato UUID en el servidor.
- El reset consume un hash SHA-256 del token de forma atómica vía RPC, con
  expiración de 24 horas.
- Solo `super_admin` puede generar tokens de reset.

---

## Alternativas consideradas

1. **Comodín `*` en la allowlist de Redirect URLs de Supabase** — Rechazado:
   amplía la superficie de ataque para abuso de redirects/host-header, y los
   comodines de Supabase son limitados.
2. **Resolver el origen en el servidor por petición** — Rechazado: la URL de
   callback debe conocerse en el momento del sign-in (el redirect OAuth se
   construye en el cliente), y `NEXT_PUBLIC_SITE_URL` ya está validado e
   inlineado en build time.
3. **Mantener `window.location.origin` como primario** — Rechazado: no es
   estable entre alias y previews, y no está garantizado que esté en la
   allowlist.

---

## Consecuencias

### Positivas

- Los callbacks OAuth de producción aterrizan siempre en el dominio canónico
  (predecible y allowlistado).
- El flujo de login con Google funciona en producción sin redirigir al login
  de Vercel.
- El flujo de reset de contraseña funciona para usuarios sin sesión.
- El error de callback ahora orienta al usuario/ops sobre las dos causas más
  comunes (allowlist de Supabase y Deployment Protection de Vercel).

### Negativas / Riesgos

- **Previews con Google login**: los deployments de preview que necesiten
  login con Google deben listar su propio dominio en la allowlist o aceptar
  que el callback vaya al dominio canónico de producción.
- **Env var inlineada en build time**: si la variable de producción está mal
  configurada (p. ej. apuntando a localhost), el callback cae al origen de
  navegación. Queda documentado como requisito de despliegue
  (`docs/ENVIRONMENT.md`).
- **Dependencia de la configuración de plataforma**: la protección de
  deployments de Vercel es una configuración de dashboard; si se re-habilita
  para producción, el bug reaparece aunque el código no cambie.

### Neutrales

- El flujo de desarrollo local no cambia: `SITE_URL=localhost` se omite y se
  usa `window.location.origin`.
- Todos los strings visibles al usuario permanecen en español.

---

## Archivos Modificados/Creados

| Archivo | Acción |
|---------|--------|
| `src/components/layout/google-signin-button.tsx` | MODIFY — `getCallbackOrigin()` prioriza el origen canónico de `NEXT_PUBLIC_SITE_URL` (con guarda de esquema http/https y exclusión de localhost); fallback a `window.location.origin` y `http://localhost:3000` |
| `src/app/auth/auth-code-error/page.tsx` | MODIFY — hint de Vercel Deployment Protection en el mensaje de `missing_code` |
| `src/lib/supabase/middleware.ts` | MODIFY — `/auth/reset-password` añadido a `PUBLIC_ROUTES` |
| `docs/DEPLOYMENT.md` | MODIFY — nueva sección "Vercel Authentication (Deployment Protection)" |
| `docs/ENVIRONMENT.md` | MODIFY — clarificación de `NEXT_PUBLIC_SITE_URL` como dominio canónico obligatorio en la allowlist de Supabase |
| `tasks/fix-prod-login-vercel-redirect.json` | CREATE — tarea del fix (rama `fix/prod-login-vercel-redirect`) |

---

## Estado

- Tests: 270/270 pasando.
- Security scan: PASS (0 HIGH, 0 MEDIUM).
- QA: código aprobado (este ADR era el ítem de completitud requerido).
