# ADR-023: Sprint 23 — PWA: Progressive Web App (Instalable + Offline)

**Status:** Accepted (Implementado) · **Date:** 2026-08-20 · **Sprint:** 23 ·
**Branch:** `feature/sprint-23-pwa`

---

## Context

La app (comparsa con miembros, roles y management) se usa **principalmente en móvil**, pero no
era instalable ni tenía soporte offline: dependía de la red para cualquier navegación y de la
recarga completa del bundle en cada visita. Además, el menú inferior móvil (`bottom-nav.tsx`,
diseñado en el Sprint 1 con `justify-around` fijo) **desbordaba en pantallas estrechas para los
roles con muchos ítems** — hasta **15 secciones para `super_admin`** (9 base + 6 por rol:
Miembros, Estadísticas, Administración de miembros, Aprobaciones, Configuración, Auditoría;
`src/components/layout/nav-links.ts`), dejando las últimas secciones **inaccesibles** sin swipe.

`next-pwa` 5.6.0 ya estaba en las dependencias (sin usar); no existía `manifest.json`, ni iconos
PNG (solo `/icons/icon.svg`), ni página de respaldo offline, ni banner de instalación.

Se requería (criterios de aceptación del task file):

- La aplicación es instalable en navegadores compatibles (Chrome, Edge, Safari iOS): manifest
  válido, SW registrado e iconos correctos.
- Los assets estáticos se cachean y la app funciona offline (página `/offline` personalizada de
  respaldo).
- El manifest tiene todos los campos requeridos e iconos PNG 192/512 con `purpose` `any` y
  `maskable`.
- Los iconos (incluido `apple-touch-icon` 180×180) se muestran correctamente tras la instalación.
- El menú inferior en móvil es deslizable horizontalmente y muestra **todas** las secciones
  (ninguna queda inaccesible), con scrollbar oculto y sin romper el diseño existente.

### Estado previo

- `next-pwa@^5.6.0` en `dependencies` (sprint previos) pero sin `withPWA` en `next.config.ts`;
  sin service worker, sin manifest, sin iconos PNG (solo `public/icons/icon.svg`), sin página
  offline.
- El bottom-nav móvil (`src/components/layout/bottom-nav.tsx`) usaba `justify-around` en un flex
  de ancho fijo: con 15 ítems de `super_admin` los últimos quedaban fuera de la pantalla sin
  forma de alcanzarlos.
- La navegación (`src/components/layout/nav-links.ts`) ya era por rol vía `isManagementRole`/
  `isAdminRole`/`hasPermission` (ADR-021 D8), lo que define el conjunto de ítems por rol que el
  sprint debe hacer deslizable.
- `src/types/database.types.ts` no se toca en este sprint (cero cambios de BD): el sprint es
  **frontend/build tooling**, sin migraciones SQL ni componente Supabase nuevo.
- La app ya servía security headers globales en `next.config.ts` (CSP, HSTS, etc.); la
  configuración de PWA debe convivir con ellos (mismo `nextConfig`, envuelto por `withPWA`).

---

## Decisión

### D1 — `withPWA` (next-pwa 5.6.0) envuelve `next.config.ts`: shell precacheado + fallback offline

`withPWA` envuelve el `nextConfig` existente (security headers y remote patterns intactos) con:

| Opción | Valor | Efecto |
|---|---|---|
| `dest` | `"public"` | El SW y los artefactos workbox se generan en `public/` en el build |
| `disable` | `process.env.NODE_ENV === "development"` | Sin SW en `next dev` (el HMR rompería con el SW); solo producción |
| `register` | `true` | Registro automático del SW |
| `skipWaiting` | `true` | Un SW nuevo toma control inmediato tras instalarse (sin esperar cierre de pestañas) |
| `cacheOnFrontEndNav` | `true` | Las navegaciones client-side del App Router se cachean para arranques rápidos |
| `navigateFallback` | `"/offline"` | Cualquier navegación que falle offline sirve la página de respaldo propia |
| `navigateFallbackDenylist` | `[/^\/auth\//, /^\/api\//, /^\/admin/, /\.(?:png\|jpg\|jpeg\|gif\|svg\|ico\|webp\|avif\|json\|css\|js\|woff2?)$/i]` | **Nunca** se secuestra tráfico de auth, API ni admin, ni ficheros estáticos |
| `additionalManifestEntries` | `[{ url: "/offline", revision: "umsuka-offline-v1" }]` | La página offline se **precachea explícitamente** como parte del shell (ver alternativa (b)) |

**Artefactos no versionados**: `public/sw.js` y `public/workbox-*.js` son generados por
`next-pwa` en cada `next build` y están en **`.gitignore`** (líneas `public/sw.js` y
`public/workbox-*.js`) — nunca se commitean; el build del deploy los produce.

### D2 — `runtimeCaching` por familia de rutas (5 estrategias)

Los `urlPattern` de la API se construyen con `supabasePattern(pathname)` a partir de
`SUPABASE_ORIGIN` (derivado de `NEXT_PUBLIC_SUPABASE_URL`, trim de la barra final y
`escapeRegExp`); si la variable no existe en build, degrada a `https://supabase.local`, un host
que nunca matchea, para que **nada se cachee por accidente**.

| Familia | `urlPattern` | Handler | `cacheName` | Expiración | Notas |
|---|---|---|---|---|---|
| PostgREST | `^<origin>/rest/v1/` | **NetworkFirst** | `umsuka-api-v1` | **15 min** (`maxAgeSeconds: 900`), **60 entradas**, `networkTimeoutSeconds: 5` | Red primero para datos frescos; caché de **rescate** corta mientras offline. Plugin `cacheKeyWillBeUsed` con clave **scoped por identidad** (D3). Solo respuestas `[0, 200]` |
| Supabase Auth | `^<origin>/auth/v1/` | **NetworkOnly** | — | — | **Nunca** se cachean tokens, cookies ni tráfico OAuth |
| Assets compilados | `/\/_next\/static\/.+$/i` | **StaleWhileRevalidate** | `umsuka-static-v1` | 30 días, 200 entradas | Los chunks precacheados salen del precache; esta regla captura chunks nuevos post-deploy |
| Imágenes/estáticos de `public` | `/(?:\.(?:png\|jpg\|jpeg\|gif\|svg\|ico\|webp\|avif)$\|\/manifest\.json$)/i` | **CacheFirst** | `umsuka-images-v1` | 30 días, **200 entradas** | Inmutables durante el build; seguras para cache-first |
| Página offline | `/^\/offline(?:[/?#]\|$)/` | **NetworkFirst** (refuerzo) | `umsuka-offline-v1` | 24 h, 5 entradas | Network-first online (mantiene la copia al día); disponible al instante vía precache (D1) |

Todas las reglas son `GET` y `cacheableResponse: { statuses: [0, 200] }` (0 = respuestas
opaque/offline-safe).

### D3 — Clave de caché scoped por identidad para la API (plugin `cacheKeyWillBeUsed` + hash FNV-1a)

La caché `umsuka-api-v1` comparte espacio entre usuarios del mismo navegador (dispositivos
compartidos). Para impedir que la PII de un usuario (email/teléfono en endpoints de perfiles)
aparezca en la sesión cacheada de otro, el plugin `cacheKeyWillBeUsed` de la regla PostgREST
deriva la clave workbox del **header `Authorization`**:

```js
cacheKeyWillBeUsed: async ({ request }) => {
  const auth = request.headers.get("Authorization") ?? "anon";
  // FNV-1a 32-bit — hash corto y estable, sin dependencias.
  let hash = 0x811c9dc5;
  for (let i = 0; i < auth.length; i++) {
    hash ^= auth.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${request.url}::${(hash >>> 0).toString(36)}`;
}
```

- **El token nunca se almacena crudo** (ni en la clave ni en el valor): solo el hash FNV-1a
  32-bit en base 36 del header, con fallback `"anon"` para peticiones sin header.
- El hash debe ser **self-contained**: workbox-build serializa el plugin literalmente dentro del
  `public/sw.js` generado, por lo que el cuerpo de la función no puede referenciar nada externo
  (comentado en `next.config.ts`).
- Consecuencia de diseño: cada usuario (token distinto) tiene su propio conjunto de entradas en
  `umsuka-api-v1`; las 60 entradas se reparten entre usuarios del dispositivo.

### D4 — La caché de API se limpia en logout

Ambos formularios de cierre de sesión (sidebar desktop y dashboard móvil) borran la caché de API
en el `onSubmit`, **antes** de que la server action `signOutAction` complete:

```ts
// PII hygiene: drop the identity-scoped API cache (see cacheKeyWillBeUsed
// in next.config.ts) on sign-out.
if ("caches" in window) {
  void window.caches.delete("umsuka-api-v1");
}
```

`src/components/layout/sidebar.tsx` y `src/app/dashboard/dashboard-content.tsx`, con el guard
`"caches" in window` (fuera de SW o navegadores sin CacheStorage no rompe). Best-effort: si el
borrado falla, las claves identity-scoped de D3 siguen impidiendo la fuga cross-user.

### D5 — `public/manifest.json` reescrito (Web App Manifest completo)

| Campo | Valor |
|---|---|
| `id` | `"/"` |
| `name` / `short_name` | `"Umsuka Imbali App"` / `"Umsuka"` |
| `description` | la descripción de la plataforma (espejo del metadata del layout) |
| `start_url` | `"/dashboard"` (decisión del plan: la app arranca en el dashboard; requiere sesión — limitación aceptada, ver Consecuencias) |
| `scope` | `"/"` |
| `display` | `"standalone"` |
| `orientation` | `"portrait-primary"` |
| `background_color` / `theme_color` | `"#0369b4"` |
| `lang` | `"es"` |
| `categories` | `["social", "productivity"]` |
| `icons` | `icon-192x192.png` (any), `icon-512x512.png` (any), `icon-maskable-512x512.png` (maskable), `icon.svg` (any, `sizes: "any"`) |

### D6 — Iconos PWA generados en local con sharp (script `icons:generate`)

`scripts/generate-pwa-icons.mjs` (ejecutable con `npm run icons:generate`) genera los 4 PNG a
partir de la primera fuente existente de `public/logo.png` → `public/icons/icon.svg` (sharp,
`^0.34.5`, añadido como devDependency):

| Salida | Tamaño | Detalle |
|---|---|---|
| `icon-192x192.png` | 192 | `purpose` any |
| `icon-512x512.png` | 512 | `purpose` any |
| `icon-maskable-512x512.png` | 512 | **Logo al ~68%** del lienzo centrado sobre el fondo sólido `#0369b4` — dentro de la safe zone del 80% del spec maskable |
| `apple-touch-icon.png` | 180 | full-bleed para iOS Safari |

Se rechazó el generador online (requiere red, ver alternativa (d)); el script es reproducible en
local y documenta el comando en `package.json`.

### D7 — Página `/offline` (server estática + cliente interactivo)

- `src/app/offline/page.tsx`: server component con `export const dynamic = "force-static"`
  (**sin auth, sin datos**: el shell offline nunca puede depender de la sesión) y metadata
  `title: "Sin conexión"` (→ "Sin conexión | Umsuka Imbali App" por el template del layout).
- `src/app/offline/offline-content.tsx`: cliente — logo (`/icons/icon-512x512.png`), título
  "Sin conexión", mensaje, botón **Reintentar** (`window.location.reload()`) y listener
  **`online`** que recarga automáticamente al recuperar la conexión, con **cleanup** en
  `useEffect` (sin listeners huérfanos en unmount).
- Se sirve por el `navigateFallback` del SW (D1) cuando una navegación falla offline.

### D8 — `PwaRegister`: banner de instalación (montado en el layout raíz)

`src/components/pwa/pwa-register.tsx` (client, montado en `<body>` de `src/app/layout.tsx`):

- Escucha **`beforeinstallprompt`** (evento Chromium-only, tipado localmente: la interfaz
  `BeforeInstallPromptEvent` declara `prompt()` y `userChoice` porque no está en los lib types
  de DOM), hace `preventDefault()` y guarda el evento diferido + muestra el banner.
- **`Instalar`** → `deferredPrompt.prompt()` + `userChoice`: `accepted` oculta el banner;
  `dismissed` (diálogo nativo cerrado) **mantiene** el banner (el descarte del diálogo del
  navegador no persiste).
- **`No, gracias`** → persiste el rechazo en `localStorage` bajo
  `umsuka.pwa.install.dismissed` (con `try/catch`: en modo privado o sin storage el banner
  volverá a mostrarse) y oculta el banner.
- **`appinstalled`** → oculta el banner.
- Detección de "ya instalada" (`isInstalledPwa`): `matchMedia("(display-mode: standalone)")` **o**
  `navigator.standalone === true` (iOS Safari) → no se muestra nunca el banner.
- Layout: fijo sobre el bottom-nav (`fixed inset-x-0 bottom-16 z-40 mx-4 max-w-md`), tarjeta con
  título, botón primario "Instalar" y ghost "No, gracias".

### D9 — `bottom-nav.tsx` deslizable: todas las secciones accesibles en móvil

El contenedor del nav pasa de `justify-around` (desbordaba) a scroll horizontal con scrollbar
oculto:

- `overflow-x-auto overscroll-x-contain` (el swipe no propaga el scroll al body) con
  `px-2 py-1` y `gap-1`.
- **Scrollbar oculto por CSS**: `[scrollbar-width:none]` (Firefox) +
  `[&::-webkit-scrollbar]:hidden` (Chromium/WebKit) — clases arbitrarias de Tailwind, sin romper
  la altura del nav ni el diseño.
- Cada `Link` con `shrink-0` (ningún ítem se comprime; el swipe no puede colapsar secciones) y
  `px-3 py-2`; el badge de notificaciones (`NavNotificationBadge`, Sprint 20) y el estado activo
  (`isLinkActive`) se conservan intactos.

Con 15 ítems de `super_admin` el contenedor excede el ancho y las secciones se alcanzan por
swipe; con 9 ítems de `member` entra en pantalla sin scroll (testeado, ver Tests).

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| (a) No hacer PWA / app nativa (App Store / Play) | Fuera del alcance del sprint: coste de publicación, revisión y mantenimiento de tiendas; la PWA cubre instalación, offline y shell con el stack existente (D1–D9). |
| (b) `precachePages` automático de next-pwa para el shell HTML | **No aplica con App Router**: la app no tiene `pages/` y next-pwa no precachea HTML de rutas del App Router automáticamente. Se precachea `/offline` explícitamente con `additionalManifestEntries` + una regla NetworkFirst de refuerzo (D1/D2). |
| (c) Cachear toda la API sin control (clave por URL, sin NetworkOnly de auth) | Rechazado por seguridad: en un dispositivo compartido, la respuesta cacheada de un usuario aparecería en la sesión de otro (PII). Se eligió la combinación identity-scoped `cacheKeyWillBeUsed` (D3) + `NetworkOnly` para `/auth/v1/*` + TTL corto (15 min) + limpieza en logout (D4). |
| (d) Generador online de iconos PWA | Requiere red y no es reproducible en CI; el script local con sharp es determinista, versionable y genera también el maskable y el apple-touch-icon (D6). |
| (e) Scroll nativo visible en el bottom-nav (o sin scroll) | El scrollbar visible degrada la UX de un nav de borde fijo; se oculta con `scrollbar-width:none` + `::-webkit-scrollbar:hidden` manteniendo el swipe (D9). |

---

## Edge cases manejados

| Escenario | Comportamiento |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` ausente en build | `SUPABASE_ORIGIN` degrada a `https://supabase.local` (host que nunca matchea): **nada** se cachea por accidente; `escapeRegExp` neutraliza caracteres regex del origen |
| Dispositivo compartido entre usuarios | Claves de caché distintas por hash FNV-1a del `Authorization` de cada uno (D3); el token nunca se almacena crudo — solo el hash en la clave |
| Navegación offline a una ruta no cacheada | `navigateFallback` → `/offline`; el denylist excluye `/auth/*`, `/api/*`, `/admin` y extensiones estáticas (D1) |
| Tráfico `/auth/v1/*` | `NetworkOnly`: tokens/cookies/OAuth jamás entran en caché (D2) |
| Logout | `window.caches.delete("umsuka-api-v1")` en los dos forms de sign-out, con guard `"caches" in window` (D4) |
| Respuestas con status no `[0, 200]` | No cacheables (`cacheableResponse.statuses`) — errores HTTP nunca se sirven desde caché |
| `localStorage` no disponible (modo privado, cuota) | `try/catch` en `readDismissed`/`persistDismissed`: el banner se vuelve a mostrar (D8) |
| App ya instalada (standalone Android/PWA o iOS) | `isInstalledPwa` (display-mode standalone `||` `navigator.standalone`) → sin banner (D8) |
| Usuario descarta el diálogo nativo de instalación (`userChoice: "dismissed"`) | El banner **permanece**; solo "No, gracias" persiste el rechazo en `localStorage` (D8) |
| Navegador sin `beforeinstallprompt` (Safari iOS, Firefox) | Sin banner; la instalación es manual vía el menú del navegador ("Añadir a pantalla de inicio") — limitación de plataforma documentada |
| SW desactualizado en una pestaña abierta larga | `skipWaiting: true` (D1): el SW nuevo toma control sin esperar cierres |
| Recuperación de conexión estando en `/offline` | Listener `online` → `window.location.reload()` automático; botón "Reintentar" manual; cleanup en unmount (D7) |
| Nav con 15 ítems (`super_admin`) en pantalla estrecha | Scroll horizontal con `overscroll-x-contain`, scrollbar oculto y `shrink-0`: todas las secciones alcanzables por swipe, activo/badge intactos (D9; testeado) |

---

## Consecuencias

### Positivas

- **Instalable** en Android/Chrome/Edge vía manifest + SW (`display: standalone`, iconos
  `any`/`maskable`, `apple-touch-icon` 180×180 y metadata `appleWebApp` + `viewportFit: cover`
  para iOS Safari).
- **Offline real de rescate**: shell precacheado (`/offline`) + assets compilados
  (StaleWhileRevalidate) + imágenes (CacheFirst) + datos de API recientes (NetworkFirst 15 min),
  con página `/offline` propia (estática, sin dependencia de sesión) y recarga automática al
  recuperar la conexión.
- **Navegación completa en móvil**: el bottom-nav con 15 ítems de `super_admin` deja de
  ocultar secciones; 9 ítems base de `member` sin scroll; scrollbar oculto sin degradar la UX.
- **Banner de instalación** con `beforeinstallprompt`/`appinstalled`, detección de standalone
  (incl. iOS) y rechazo persistente opt-out en `localStorage`.
- **Iconos correctos en todas las plataformas**: 192/512 `any`, 512 `maskable` (safe zone) y
  `apple-touch-icon` — generados localmente y reproducibles (`npm run icons:generate`).
- **Cero cambios de BD**: sprint de frontend/tooling sin migraciones.
- **Suite nueva verde**: 12 tests en 2 suites nuevas (`bottom-nav.test.tsx`, 4;
  `pwa-register.test.tsx`, 8) — verificados en local con `npx vitest run`.

### Seguridad (defensa en profundidad)

- **Sin fuga cross-user en dispositivos compartidos**: la caché de API es identity-scoped (hash
  FNV-1a del `Authorization` como parte de la clave workbox, D3) y se limpia en logout (D4).
- **Auth nunca se cachea**: `/auth/v1/*` en `NetworkOnly` (D2); el `navigateFallback` lista en
  el denylist `/auth/*`, `/api/*`, `/admin` y estáticos (D1).
- **Errores no cacheables**: solo `statuses: [0, 200]` entran en cualquier caché (D2).
- **Accidental-cache prevention**: sin `NEXT_PUBLIC_SUPABASE_URL` en build, los patrones de API
  degradan a un host que nunca matchea (D2).
- **El token no se persiste**: ni crudo ni en la clave de caché, solo el hash (D3).
- El CSP existente (connect-src a `*.supabase.co`, etc.) queda intacto: `withPWA` envuelve el
  `nextConfig` sin alterar los headers de seguridad.

### Riesgos / pendientes

- **Verificación manual pendiente en Safari iOS**: instalación real (apple-touch-icon, A2HS),
  registro del SW y ausencia de `beforeinstallprompt` (instalación manual; sin banner)
  requieren dispositivo iOS — no disponible en el entorno de implementación. El DoD del task
  file pide esta verificación manual de instalación/offline.
- **El "never cache" de auth limita el offline profundo**: con el token caducado o sin sesión
  previa, las llamadas API fallan en red; la caché de API solo sirve datos leídos **con la misma
  sesión** (claves identity-scoped) y con TTL corto de 15 min (60 entradas) — offline de
  **rescate**, no de trabajo sin red.
- **`start_url: /dashboard` requiere sesión** (decisión del plan): una alarma standalone sin
  sesión redirige a `/auth/login` (o `/offline` sin red, vía navigateFallback) — comportamiento
  asumido y documentado en el manifest.
- **Artefactos del SW no versionados**: `public/sw.js` y `public/workbox-*.js` están en
  `.gitignore` y se regeneran en cada `next build` — el deploy debe confiar en el build de CI
  para producirlos.
- **next-pwa 5.6.0 + Next 15**: la nota del task file avisa de posible necesidad de webpack
  fallback; el build de producción se valida como parte del DoD antes del merge.
- `tasks/sprint-23-pwa.json` (gestionado por el orquestador) vive en el working tree; los
  cambios de código también (sin commitear aún, rama actual `master`). La rama prevista es
  `feature/sprint-23-pwa` siguiendo `docs/git-conventions.md`; el PR y el escaneo
  security-champion los gestiona el pipeline estándar.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `next.config.ts` | MODIFY — `withPWA` (dest public, disable en dev, register, skipWaiting, cacheOnFrontEndNav, `navigateFallback: "/offline"` + denylist, `additionalManifestEntries` de `/offline`) y 5 reglas `runtimeCaching` con `supabasePattern`/`SUPABASE_ORIGIN` (degrade seguro), plugin `cacheKeyWillBeUsed` FNV-1a self-contained; `nextConfig` (headers/remotePatterns) intacto |
| `package.json` | MODIFY — `next-pwa@^5.6.0` ya presente en dependencies (sin cambios de versión); `sharp@^0.34.5` como devDependency; script `"icons:generate": "node scripts/generate-pwa-icons.mjs"` |
| `public/manifest.json` | MODIFY — reescrito: id, name/short_name, description, start_url `/dashboard`, scope `/`, display standalone, orientation portrait-primary, colores `#0369b4`, lang `es`, categories, 4 iconos (192/512 any, 512 maskable, svg any) |
| `scripts/generate-pwa-icons.mjs` | CREATE — generador con sharp: 192/512 `any`, maskable 512 (logo 68% sobre `#0369b4`, safe zone del 80%), apple-touch 180; fuente `public/logo.png` → fallback `public/icons/icon.svg` |
| `public/icons/icon-192x192.png`, `icon-512x512.png`, `icon-maskable-512x512.png`, `apple-touch-icon.png` | CREATE — PNGs generados por el script (el `icon.svg` fuente se conserva) |
| `src/app/layout.tsx` | MODIFY — `metadata.manifest: "/manifest.json"`, iconos (`favicon.ico`, `icon.svg`, `apple-touch-icon` 180×180), `appleWebApp { capable, statusBarStyle, title }`, `viewport.viewportFit: "cover"` + themeColor claro/oscuro, `<PwaRegister />` montado en `<body>` |
| `src/app/offline/page.tsx` | CREATE — server component `force-static` (sin auth, sin datos), metadata "Sin conexión" |
| `src/app/offline/offline-content.tsx` | CREATE — cliente: logo, mensaje, botón "Reintentar" (reload) y listener `online` con auto-reload y cleanup |
| `src/components/pwa/pwa-register.tsx` | CREATE — banner de instalación: `beforeinstallprompt` (preventDefault + `prompt()`/`userChoice`), `appinstalled`, detección standalone (display-mode/navigator.standalone iOS), rechazo persistente en `localStorage` (`umsuka.pwa.install.dismissed`, try/catch) |
| `src/components/layout/bottom-nav.tsx` | MODIFY — contenedor con `gap-1 overflow-x-auto overscroll-x-contain` (`px-2 py-1`), scrollbar oculto (`[scrollbar-width:none]` + `[&::-webkit-scrollbar]:hidden`), `shrink-0` por `Link`; sustituye `justify-around`; badges y estado activo intactos |
| `src/components/layout/sidebar.tsx` | MODIFY — limpieza `window.caches.delete("umsuka-api-v1")` en el `onSubmit` del sign-out (guard `"caches" in window`) |
| `src/app/dashboard/dashboard-content.tsx` | MODIFY — idéntica limpieza de caché en su form de sign-out |
| `.gitignore` | MODIFY — `public/sw.js` y `public/workbox-*.js` (artefactos regenerados en build, no se commitean) |
| `tests/unit/components/bottom-nav.test.tsx` | CREATE — 4 tests (ver Tests) |
| `tests/unit/components/pwa-register.test.tsx` | CREATE — 8 tests (ver Tests) |
| `docs/adr-sprint-23-pwa.md` | CREATE — este ADR |

### Tests

| Archivo | Tests |
|---|---|
| `tests/unit/components/bottom-nav.test.tsx` (CREATE) | 4 — 15 secciones renderizadas para `super_admin` (ninguna inaccesible; sync con `getVisibleLinks`), contenedor con `overflow-x-auto`/`overscroll-x-contain`/scrollbar oculto, `shrink-0` en cada link (el swipe no colapsa ítems), y solo las 9 secciones base para `member` |
| `tests/unit/components/pwa-register.test.tsx` (CREATE) | 8 — sin banner antes de `beforeinstallprompt`; banner al recibir el evento con `preventDefault`; ocultar tras `userChoice: accepted`; banner **permanece** si el diálogo nativo se descarta; persistencia del rechazo en `localStorage` con "No, gracias"; no reaparece tras rechazo persistido; ocultar con `appinstalled`; sin banner en modo standalone (matchMedia stub; jsdom no implementa `matchMedia`) |

**Verificado en local: 12 tests en 2 archivos, todos pasando** (`npx vitest run
tests/unit/components/bottom-nav.test.tsx tests/unit/components/pwa-register.test.tsx`). El DoD
del task file además exige suite completa, `tsc --noEmit`, `eslint . --max-warnings=0` y
`next build` sin errores (SW generado), con security scan sin issues HIGH — pendientes de
ejecutar en el cierre del sprint.

---

## Referencias

- Task file: `tasks/sprint-23-pwa.json` (criterios de aceptación, DoD — incluye este ADR como
  entregable; dependencias: Sprint 1 — UI/shell/bottom-nav y Sprint 21 — admin panel, reutilizado
  en las exclusiones de caché y en `hasPermission` de nav-links).
- Plan: `tasks/plan-desarrollo-completo.md` → "Sprint 23 — PWA: Progressive Web App" (pasos 1–8,
  rama `feature/sprint-23-pwa`).
- ADR-021 (Sprint 21 — Admin Panel): `nav-links.ts` con `hasPermission` (D8) define los ítems
  del bottom-nav por rol que este sprint hace deslizables; los ítems `/admin/*` se excluyen del
  `navigateFallback` del SW.
- ADR-020 (Sprint 20 — Notificaciones): `NavNotificationBadge` (bottom-nav) se conserva intacto
  con el nuevo scroll horizontal.
- ADR-022 (Sprint 22 — Eliminación de Cuentas): referencia del patrón de "working tree + rama
  planificada + pipeline" seguido en el cierre del sprint.
- Directivas globales: `docs/git-conventions.md` (ramas `feature/<sprint>`, commits semánticos),
  `docs/DEPLOYMENT.md` (build de producción, donde se regeneran `sw.js`/`workbox-*.js`).