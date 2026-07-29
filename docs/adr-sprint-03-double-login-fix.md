# ADR-003: Sprint 3 — Bugfix: Doble Login en Página Principal

**Status:** Accepted · **Date:** 2026-07-29

---

## Context

Users of the Umsuka Imbali App had to click the "Iniciar sesión con Google"
button **twice** before successfully reaching the dashboard. After the first
click, the OAuth flow completed (Google consent was granted), the browser was
redirected back to the app's callback URL, but the app redirected the user
back to `/auth/login` instead of `/dashboard`. A second click would then
succeed.

The three root causes were:

### 1. OAuth callback not writing cookies to the response it returns

The callback handler (`GET /auth/callback`) used a Supabase client created with
the `@supabase/ssr` library's default pattern, which relies on the ambient
`next/headers` cookie store via `cookies()` from `next/headers`. The sequence
was:

1. Receive the authorization `code` from Supabase.
2. Create the Supabase client (backed by `next/headers`).
3. Call `exchangeCodeForSession(code)` — Supabase queues `Set-Cookie` headers
   in the cookie store.
4. **Return `NextResponse.redirect()`** — a brand-new response object that does
   **not** share the cookie store from step 2.

The queued cookies were silently dropped. The browser never received the
session cookie, so the next request to `/dashboard` looked unauthenticated and
the middleware redirected back to `/auth/login`.

### 2. Middleware redirect losing queued cookies

The middleware (`src/lib/supabase/middleware.ts`) calls `getUser()` on every
request, which internally refreshes the session token via
`exchangeCodeForSession()`. The refreshed cookie is queued on the
`supabaseResponse` object (a `NextResponse.next()`). When the middleware
detected an unauthenticated user and returned a bare
`NextResponse.redirect()` to `/auth/login`, the redirect response carried
none of the queued cookies. This caused a secondary failure mode: even a
valid session could appear stale if the middleware redirected for any reason.

### 3. Race condition in Google sign-in button

The `GoogleSignInButton` component did not guard against rapid double-clicks.
A fast double-click would invoke `handleSignIn()` twice in quick succession,
calling `supabase.auth.signInWithOAuth()` twice concurrently. Each call writes
its own PKCE `code_verifier` cookie. The losing call's verifier would
overwrite the winner's, and when the OAuth flow completed and the browser
returned to the callback, the stored `code_verifier` no longer matched the
one used during the authorization request. This produced the error **"PKCE
code verifier not found in storage"** and the user had to retry.

All user-facing strings are in Spanish.

---

## Decision

Four changes were made, each addressing one cause:

### 1. Write cookies directly to the response object in the callback handler

The callback route handler (`src/app/auth/callback/route.ts`) was rewritten to
follow a "response-first" pattern:

```ts
// Build the redirect response up front so the Supabase client can
// attach Set-Cookie headers directly to it.
const response = NextResponse.redirect(`${origin}${safeRedirectPath}`);

const supabase = createServerClient(/* ... */, {
  cookies: {
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet) {
      cookiesToSet.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);  // writes onto our response
      });
    },
  },
});

const { error } = await supabase.auth.exchangeCodeForSession(code);
if (error) {
  return NextResponse.redirect(`${origin}/auth/auth-code-error?reason=exchange_failed`);
}
return response;  // ← same object, cookies attached
```

Key points:
- The `NextResponse.redirect()` is created **first**, before the Supabase client.
- The `setAll` implementation writes directly to `response.cookies.set()`,
  not to the ambient `next/headers` store.
- The **same** `response` object is returned after `exchangeCodeForSession()`.
- This guarantees that whatever cookies the Supabase library sets during the
  code exchange are attached to the HTTP response the browser actually receives.

### 2. Preserve cookies through middleware redirects

A new `redirectPreservingCookies(url, baseResponse)` helper was added to
`src/lib/supabase/middleware.ts`:

```ts
function redirectPreservingCookies(url: URL, base: NextResponse): NextResponse {
  const redirectResponse = NextResponse.redirect(url);
  base.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}
```

This helper:
- Creates a `NextResponse.redirect(url)`.
- Iterates over all cookies queued on `base` (the `supabaseResponse` from
  `NextResponse.next()`) and copies them to the redirect response.
- Is used for **every** redirect the middleware performs:
  - Unauthenticated user → redirect to `/auth/login`.
  - Authenticated user on `/auth/login` → redirect to `/dashboard`.

This ensures that a session token refreshed by `getUser()` in the middleware
survives any redirect the middleware performs.

### 3. Separate cookie options for server and browser clients

A new file `src/lib/supabase/cookie-options.ts` defines two sets of cookie
options:

| Export | `httpOnly` | `secure` | Purpose |
|---|---|---|---|
| `SERVER_AUTH_COOKIE_OPTIONS` | `true` | `NODE_ENV === "production"` | Used by Server Components, Server Actions, Route Handlers, middleware |
| `BROWSER_AUTH_COOKIE_OPTIONS` | — (falsy) | `NODE_ENV === "production"` | Used by `src/lib/supabase/client.ts` (browser-side `document.cookie`) |

**Why `secure` is environment-aware:**

- Vercel production is always HTTPS.
- Local development is always HTTP.
- Leaving `secure: true` unset (the library default) would cause browsers to
  silently drop cookies when testing on `http://127.0.0.1:3000` or any
  non-`localhost` HTTP host. The `NODE_ENV` check makes this explicit.

**Why two sets:**

- Server-side cookies **must** be `httpOnly` to prevent XSS from stealing
  the session token.
- Browser-side cookies are set via `document.cookie`, which **cannot** create
  `HttpOnly` cookies — JavaScript is structurally incapable of it. Prior to
  this fix, passing `httpOnly: true` to the browser client caused the PKCE
  `code_verifier` cookie write to be silently dropped, producing the
  "PKCE code verifier not found" error.

### 4. Double-click guard on the Google sign-in button

A `useRef<boolean>(false)` guard was added to
`src/components/layout/google-signin-button.tsx`:

```ts
const hasStartedRef = useRef(false);

async function handleSignIn() {
  if (hasStartedRef.current) {
    return;  // second call is a no-op
  }
  hasStartedRef.current = true;
  setIsLoading(true);
  // ... signInWithOAuth() ...
}
```

- `hasStartedRef` is set to `true` **before** the async `signInWithOAuth()` call.
- It is reset to `false` **only** if the call fails (so the user can retry).
- On success, the page navigates away to Google, so the ref value becomes
  irrelevant.
- The button's `disabled` prop (`disabled={isLoading}`) provides a second
  layer of defense, but `useRef` catches the race before React's state update
  takes effect.

---

## Alternatives Considered

1. **Rely on middleware to set cookies on every response** — Rejected because
   the middleware redirect (`/auth/login`) would still drop the initial session
   cookie from the callback. The callback handler is the first point where the
   session cookies are created; there is no prior request whose response could
   carry them.

2. **Use a singleton cookie store** — Rejected because it would break
   per-request isolation in a serverless environment (Vercel Edge Functions).
   Concurrent requests from different users could corrupt each other's sessions.

3. **Skip PKCE and use the implicit OAuth flow** — Rejected because the
   implicit flow exposes the access token in the URL fragment, which is a
   security concern (token leakage via Referer headers, server logs, browser
   history). The authorization code + PKCE flow is the recommended OAuth 2.1
   pattern.

---

## Consequences

### Positive

- **Single-click login** — Users click the Google sign-in button once and reach
  the dashboard. No more double-click workaround.
- **Cookies reliably reach the browser** — The callback handler writes session
  cookies directly onto the response it returns, eliminating the silent-drop
  bug.
- **Middleware redirects preserve cookies** — The `redirectPreservingCookies`
  helper ensures that refreshed session tokens survive any middleware redirect.
- **No more PKCE verifier race** — The `useRef` guard prevents concurrent
  `signInWithOAuth()` calls. The `BROWSER_AUTH_COOKIE_OPTIONS` (no `httpOnly`)
  ensures the `code_verifier` cookie is actually stored by the browser.
- **Environment-aware `secure` flag** — Local development works without silent
  cookie drops; production enforces `Secure` cookies as expected.
- **All authentication paths use shared cookie configuration** — The
  `cookie-options.ts` module is the single source of truth for cookie
  attributes across the entire application.

### Negative

- **The middleware now performs double duty** — it acts as both an auth guard
  (redirect unauthenticated users) and a session refresher (call `getUser()`
  on every request). The `redirectPreservingCookies` helper must be used for
  **every** redirect from the middleware; forgetting it reintroduces the bug.
- **The callback handler is more verbose** — the response-first pattern is less
  conventional than the standard `@supabase/ssr` setup, which may confuse
  future contributors unfamiliar with the cookie-dropping edge case.
- **All protected routes depend on the middleware running first** — the root
  middleware matcher (`matcher: "/((?!_next/static|_next/image|favicon.ico).*)"`)
  covers all non-public paths. Any path not matched by the middleware will not
  have its session refreshed automatically.

### Neutral

- **All user-facing strings remain in Spanish.**
- **The `createClient()` function in `src/lib/supabase/server.ts`** still uses
  the ambient `next/headers` cookie store with a `try/catch` around `setAll`.
  This is correct: Server Components can read but not write cookies, and the
  middleware handles session refresh. The callback handler is a Route Handler
  (not a Server Component) and uses the response-first pattern instead.
- **The `cookie-options.ts` module** is new and centralizes cookie configuration
  that was previously implicit in the library defaults.

---

## File Manifest

### New files

| File | Purpose |
|---|---|
| `src/lib/supabase/cookie-options.ts` | Centralized cookie configuration: `SERVER_AUTH_COOKIE_OPTIONS` and `BROWSER_AUTH_COOKIE_OPTIONS` with environment-aware `secure` flag |

### Modified files

| File | Change |
|---|---|
| `src/app/auth/callback/route.ts` | Rewritten to response-first pattern: creates `NextResponse.redirect()` before the Supabase client, writes cookies directly onto the response, returns the same response object |
| `src/lib/supabase/middleware.ts` | Added `redirectPreservingCookies()` helper; all middleware redirects now preserve queued cookies; imports `SERVER_AUTH_COOKIE_OPTIONS` |
| `src/lib/supabase/server.ts` | Updated to import and use `SERVER_AUTH_COOKIE_OPTIONS` from the new `cookie-options.ts` module |
| `src/lib/supabase/client.ts` | Updated to import and use `BROWSER_AUTH_COOKIE_OPTIONS` to fix the PKCE `code_verifier` cookie being silently dropped |
| `src/components/layout/google-signin-button.tsx` | Added `useRef<boolean>(false)` guard (`hasStartedRef`) to prevent concurrent `signInWithOAuth()` calls |
| `tests/e2e/auth.spec.ts` | Updated E2E tests to validate single-click login flow and PKCE verifier consistency |
