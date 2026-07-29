# ADR-004: Sprint 4 — Página de Inicio / Dashboard (Home Feed)

**Status:** Accepted · **Date:** 2026-07-29

---

## Context

Sprint 4 redesigns the `/dashboard` home page to serve as a central hub for
members, transforming it from a simple welcome card into a dashboard that
surfaces at-a-glance information. Before this sprint, the dashboard displayed a
single welcome card with the user's name, role badges, and a logout button —
purely informational with no actionable content or external service integration.

Three functional gaps existed:

1. **No social media presence** — the association maintains an active Instagram
   account (@umsukaimbali) but there was no way to surface the account or its
   posts within the app.
2. **No notification system** — members had no way to see recent updates, shift
   assignments, or absence approvals without navigating to specific pages.
3. **No calendar overview** — upcoming events were only visible by navigating to
   `/events` or `/calendar`.

Additionally, two OAuth reliability issues were discovered during this sprint:

4. **OAuth redirect URL mismatch** — the Google sign-in button used
   `window.location.origin` to construct the callback URL, but when the
   `NEXT_PUBLIC_SITE_URL` environment variable differed from the browser origin,
   Supabase silently fell back to its configured "Site URL" (typically the
   production domain), causing localhost logins to land on the production domain.
5. **OAuth session cookie not persisting** — the auth callback route's code
   exchange succeeded but the session cookie never reached the browser because
   `Set-Cookie` headers were not attached to the redirect response. The next
   request (to `/dashboard`) appeared unauthenticated and bounced back to
   `/auth/login`.

Two configuration gaps were also addressed:

6. **Missing image hostname** — `images.unsplash.com` was not in the Next.js
   `remotePatterns` or Content-Security-Policy, causing Instagram mock images
   (used in tests) to be blocked.
7. **Missing logo avatar** — the Instagram profile section uses the site logo
   (`/logo.png`) as the avatar since no Instagram API credentials are configured.

The project follows its established architecture patterns:
- Server components for data fetching, client components for interactivity.
- Supabase (PostgreSQL) with Row Level Security (RLS).
- Tailwind CSS with ShadCN UI primitives for styling.
- Zod schemas for validation, queries/mutations for data access.

Architecture, database, and deployment context are documented in
`docs/ARCHITECTURE.md`, `docs/DATABASE.md`, and `docs/DEPLOYMENT.md`.

Previous ADRs: ADR-001 (Sprint 1 — UI redesign), ADR-002 (Sprint 2 — Workgroup
roles), ADR-005 (Sprint 5 — Attendance and Absences).

---

## Decision

### Dashboard Layout — Responsive Stacked Sections

The dashboard abandons the CSS Grid two-column approach from the initial
sprint plan in favor of a simpler stacked layout:

```
┌───────────────────────────────────────────┐
│  Welcome Banner (full width)               │
│  Nombre, rol, tipo de componente badges    │
├───────────────────────────────────────────┤
│  Instagram Profile (full width)            │
│  Avatar (gradient border) · Name · @user   │
│  "Seguir en Instagram" button              │
├───────────────────────────────────────────┤
│  Notifications (mock, top 5 unread)        │
│  + "Marcar todas leídas" button           │
├───────────────────────────────────────────┤
│  Próximos Eventos (live from umsuka.events)│
│  + "Ver todos" link                       │
├───────────────────────────────────────────┤
│  Tu sesión (email + logout button)         │
└───────────────────────────────────────────┘
```

- All sections share a common `rounded-xl border bg-card p-5` card style.
- The Instagram Profile section spans full width above the other cards.
- Notifications, Calendar, and Session info stack vertically below.
- A `SectionHeader` component provides a consistent title+icon+action pattern
  shared by all sections.

The layout is implemented in `dashboard-content.tsx` (a `"use client"` component
that receives pre-fetched data from the server page).

### Instagram Profile Display — Avatar, Identity, and Follow Button

Instead of an Instagram post grid (which requires real API credentials), the
dashboard shows an **Instagram profile card** with the association's identity:

| Element | Implementation |
|---|---|
| **Avatar** | Circular container with Instagram-style gradient border (`from-purple-500 via-pink-500 to-orange-400`, 3px padding). Uses `next/image` loading `/logo.png` from the public directory. Falls back to initial letters (`U` / `I`) if the image fails. |
| **Full name** | `"Umsuka Imbali"` displayed as `h3` heading. |
| **Username** | `@umsukaimbali` as a clickable link to `https://www.instagram.com/umsukaimbali/` (opens in new tab). |
| **Biography** | Conditionally rendered — only shown when the API returns real biography text (currently empty, hidden). |
| **Stats** | Posts count, followers count, following count — conditionally rendered only when values are > 0 (currently all 0, hidden to avoid displaying fake zeros). |
| **Follow button** | Gradient button (`from-purple-600 to-pink-600`) with Instagram icon + "Seguir en Instagram" + external link icon. Links to the Instagram profile URL. |

This design means the dashboard always shows a meaningful Instagram presence
even without API credentials configured, while avoiding any fake data (no fake
stats, no fake posts).

### Instagram API Service — Two-Tier Architecture

The Instagram integration follows a two-tier architecture implemented in
`src/lib/social/instagram.ts`:

**1. Fetch layer** (`fetchAndCacheInstagramPosts()`):
- Calls `https://graph.instagram.com/v12.0/{userId}/media` with the access token.
- Maps API response fields (`id`, `caption`, `media_url`, `permalink`,
  `media_type`, `timestamp`) to the application's `InstagramPost` type.
- Upserts each post into the `umsuka.instagram_posts` cache table using the
  **admin client** (`createAdminClient()`) to bypass RLS for writes.
- Uses `server-only` import to prevent any client-side bundling of credentials.
- Returns `false` if no real credentials are configured (graceful degradation).

**2. Read layer** (`getCachedInstagramPosts()`):
- Reads from `umsuka.instagram_posts` using the **authenticated client**
  (`createClient()`), respecting RLS.
- Orders by `timestamp DESC`, limited to 9 posts.
- Returns an **empty array** when the cache is empty — no fake/mock posts are
  ever displayed to users. This is a deliberate hardening: previously the code
  fell back to mock data, but that was removed because mock posts show
  placeholder images (Unsplash URLs) unrelated to the association.

**3. Public convenience function** (`getInstagramPosts(limit)`):
- Thin wrapper around `getCachedInstagramPosts()`.

**4. Profile function** (`getInstagramProfile()`):
- Returns a hardcoded `InstagramProfile` object with the association's
  identity (`username: "umsukaimbali"`, `fullName: "Umsuka Imbali"`).
- `profilePictureUrl` points to `/logo.png` (site logo).
- Stat counts are set to `0` — the UI conditionally hides them, avoiding
  the display of fake numbers.

**5. Mock data** (`getMockInstagramPosts()`):
- Exists exclusively for **unit tests**. Returns a slice of `MOCK_POSTS` (9
  hardcoded posts with Unsplash placeholder images).
- Never called in production code paths.

| Function | Returns | Used by |
|---|---|---|
| `getInstagramProfile()` | `InstagramProfile` | Dashboard page (server component → client component) |
| `getInstagramPosts(limit)` | `InstagramPost[]` | Future server components (currently unused) |
| `getMockInstagramPosts(limit)` | `InstagramPost[]` | Unit tests only |

### Database Migration — `umsuka.instagram_posts`

Migration file: `supabase/migrations/20260101002500_instagram_posts.sql`

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | `serial` | `PRIMARY KEY` | Auto-incrementing PK |
| `post_id` | `text` | `NOT NULL`, `UNIQUE` | Instagram's native post ID |
| `caption` | `text` | nullable | Post caption text |
| `media_url` | `text` | `NOT NULL` | URL of the image/video media |
| `permalink` | `text` | `NOT NULL` | Link to the Instagram post |
| `media_type` | `text` | `NOT NULL DEFAULT 'image'`, `CHECK (media_type IN ('image', 'video', 'carousel'))` | Media type enum |
| `timestamp` | `timestamptz` | `NOT NULL` | Post creation timestamp |
| `cached_at` | `timestamptz` | `DEFAULT now()` | When the post was cached |

Index: `idx_instagram_posts_timestamp` on `timestamp DESC`.

RLS is enabled and forced:
- **SELECT**: `authenticated` role can read all rows (policy
  `instagram_posts_select_authenticated`).
- **INSERT/UPDATE/DELETE**: No policies for `authenticated` — writes are
  performed exclusively through the admin client, which bypasses RLS via the
  `service_role` key.

### Instagram Credentials — Environment Variables

Instagram API credentials are defined as **server-only** environment variables
in `src/lib/env.server.ts`:

| Variable | Optional | Fallback |
|---|---|---|
| `INSTAGRAM_ACCESS_TOKEN` | Yes | `NEXT_PUBLIC_INSTAGRAM_ACCESS_TOKEN` (legacy) |
| `INSTAGRAM_USER_ID` | Yes | `NEXT_PUBLIC_INSTAGRAM_USER_ID` (legacy) |

Backwards compatibility: the Zod schema reads the new `INSTAGRAM_*` variables
first, then falls back to the legacy `NEXT_PUBLIC_INSTAGRAM_*` variants.

### Notifications Widget — Mock Data (Deferred to Sprint 15+)

The `NotificationsWidget` is a `"use client"` component that displays up to
**5 notifications** from an in-memory mock data array (`generateMockNotifications()`
returns 6 items; `visibleNotifications` slices to 5).

**Mock notification types:**
- `Calendar` (blue) — new events, schedule changes.
- `Users` (green) — shift assignments, absence approvals.
- `Megaphone` (purple) — news publications.
- `Clock` (amber) — attendance reminders.

**Feature: "Mark all as read"** — a `CheckCheck` button appears when unread
notifications exist. Clicking it updates local state, setting all `read`
booleans to `true`. This is purely client-side (no persistence). Refreshing the
page resets all notifications to their unread state.

The mock data will be replaced in **Sprint 15** with real data from the
`umsuka.notifications` table. A comment in the component marks this.

### Calendar Widget — Live Data from `umsuka.events`

The calendar section is rendered **inline** within `DashboardContent` (not as
a separate server component, though a `CalendarWidget` server component exists
in the codebase for future refactoring).

- Calls `listEvents({ from: new Date().toISOString() })` to fetch future events
  from the `umsuka.events` table.
- Limits display to 5 events (`.slice(0, 5)`).
- Shows each event with:
  - Title (truncated with `truncate` class).
  - Formatted date using `es-ES` locale with smart prefixes: "Hoy", "Mañana",
    or abbreviated weekday + day + month.
  - Event type badge (`Badge` with color-coded mapping).
- Shows a "Ver todos" link to `/events`.
- Empty state: `CalendarDays` icon + "No hay próximos eventos" message.

**Date formatting:** `formatEventDate()` uses `tomorrow.setDate(tomorrow.getDate() + 1)`
for "tomorrow" detection, which handles DST transitions correctly.

### Server-Side Data Fetching (`page.tsx`)

The dashboard page (`src/app/dashboard/page.tsx`) is a **server component** that:

1. Calls `getCurrentProfile()` — redirects to `/auth/login` if unauthenticated.
2. Fetches Instagram profile and upcoming events in **parallel** via `Promise.all()`:
   ```typescript
   const [igProfile, events] = await Promise.all([
     getInstagramProfile(),
     listEvents({ from: new Date().toISOString() }),
   ]);
   ```
3. Passes data as props to the client component `DashboardContent`.

Note: Instagram **posts** are not fetched on the dashboard page — only the
profile is shown. Post fetching (`getInstagramPosts()`) is available for future
use.

### OAuth Reliability Fixes

Three related fixes address the OAuth redirect and session persistence issues:

#### 1. Callback Origin Resolution (`google-signin-button.tsx`)

The `getCallbackOrigin()` function replaces direct use of
`window.location.origin` for constructing the OAuth callback URL:

```
Priority:
1. NEXT_PUBLIC_SITE_URL env var (must match Supabase Auth → Site URL)
2. window.location.origin (current browser origin, fallback)
```

Using `NEXT_PUBLIC_SITE_URL` as the primary source ensures the callback URL
matches what Supabase has in its "Redirect URLs" allowlist. If `redirectTo` is
not in Supabase's allowlist, Supabase silently falls back to its configured
"Site URL" — which in production is the Vercel app domain. This is why
localhost logins could land on the production domain.

The sign-in button also logs the constructed callback URL to the browser
console for debugging:
```javascript
console.log("%c[GoogleSignIn] redirectTo URL...", "font-weight:bold;color:#22c55e", url);
```

A `useRef` guard (`hasStartedRef`) prevents double-invocation of
`signInWithOAuth()` on fast double-clicks, which would cause a "PKCE code
verifier not found in storage" race condition.

#### 2. Session Cookie Persistence (`auth/callback/route.ts`)

The callback route was hardened with diagnostic logging at every step:

- **Before code exchange**: Logs all cookie names present on the request.
- **After code exchange**: Verifies the session via `supabase.auth.getSession()`
  and logs the result (`expiresAt`, `userId`).
- **Cookies on response**: Logs all cookies being set on the redirect response
  (name and whether it has a value).

The route uses a critical architectural pattern: the Supabase client is created
with a `setAll` callback that writes cookies **directly onto the response
object** (not the ambient `next/headers` cookie store). This ensures `Set-Cookie`
headers actually reach the browser. Previously the exchange succeeded but the
session cookie never made it onto the response, causing the next request to
appear unauthenticated.

The error logging for missing `code` parameter was also enhanced to include:
- The actual `origin` from the callback URL.
- The value of `NEXT_PUBLIC_SITE_URL` (or "(no definido)").
- A suggestion to add the origin to Supabase's Redirect URLs list.

#### 3. Middleware Diagnostic Logging (`middleware.ts`)

The `updateSession()` middleware now logs the result of `supabase.auth.getUser()`
on every request:

```javascript
console.log("[middleware] getUser result:", {
  pathname,
  hasUser: !!user,
  userId: user?.id ?? null,
  error: getUserError ? { name, message, status } : null,
  cookieCount: request.cookies.getAll().length,
});
```

This enables server-side debugging of session issues by inspecting Vercel
deployment logs.

#### 4. Auth Code Error Page (`auth-code-error/page.tsx`)

A dedicated error page (`/auth/auth-code-error`) displays user-facing (Spanish)
messages based on the failure reason passed via query parameter:

| Reason | Message |
|---|---|
| `provider` | Google no pudo completar la autenticación o cancelaste el proceso. |
| `missing_code` | Detailed instructions explaining how to configure Redirect URLs in Supabase Dashboard, including example URLs for localhost and production. |
| `exchange_failed` | El servidor no pudo validar la sesión con Supabase. |

The `missing_code` message was enhanced to include step-by-step setup guidance
with concrete URL examples, helping administrators self-diagnose redirect URL
misconfiguration.

#### 5. Updated `.env.example`

The `NEXT_PUBLIC_SITE_URL` section was expanded with a detailed comment
explaining:
- That this URL (or at least `<origin>/auth/callback`) must be in Supabase's
  "Redirect URLs" allowlist.
- The consequence of a missing entry: Supabase silently falls back to the
  configured "Site URL", causing localhost logins to land on the production
  domain.
- Example values for local development (`http://localhost:3000`) and production
  (`https://your-app.vercel.app`).

### Security Headers and Image Hostname Fix

**Problem:** `images.unsplash.com` was missing from both the Next.js
`remotePatterns` configuration and the Content-Security-Policy `img-src`
directive. This caused:
- Instagram mock post images (used in tests) to be blocked by the CSP.
- `next/image` to refuse loading images from this domain.

**Fix:** `images.unsplash.com` was added to both:
1. `next.config.ts` → `images.remotePatterns` (HTTPS protocol).
2. `next.config.ts` → CSP `img-src` directive alongside existing Supabase and
   Google profile image hostnames.

### Server Component Cookie Handling (`server.ts`)

The comment in the catch block of `src/lib/supabase/server.ts` was improved to
clarify why `setAll` failures are silently ignored: Server Components cannot
write cookies (read-only context), but this is expected because the middleware
refreshes the session on every request. The updated comment notes that the
error could be logged at debug level via `DEBUG=supabase-ssr` in environments
that support it, but is currently suppressed to avoid noise on every render.

### Section Header Component (`section-header.tsx`)

A lightweight, reusable component shared by all dashboard sections:

| Prop | Type | Purpose |
|---|---|---|
| `title` | `string` | Section heading text |
| `icon` | `LucideIcon` (opt) | Icon displayed next to title |
| `action` | `ReactNode` (opt) | Action element (link, button) |

Renders a `border-b` header row with flex layout.

### Test Coverage

19 unit tests were added across three test files:

| Test file | Tests | Scope |
|---|---|---|
| `tests/unit/lib/social/instagram.test.ts` | 10 | `getMockInstagramPosts` — array shape, default/custom limit, property types, URL validation, ISO 8601 timestamps, edge cases (limit=0, limit>available) |
| `tests/unit/components/dashboard/notifications-widget.test.tsx` | 7 | Component rendering, unread badge count, "Mark all read" click behavior (disappears badge + button), notification titles, max 5 items |
| `tests/unit/components/dashboard/calendar-widget.test.tsx` | 2 import tests + 5 logic tests | Module import validation, event label mapping, date formatting, future-event filtering, max-5 limit, empty state |

### Test Infrastructure Updates

`tests/setup/vitest.setup.ts` added mocks for:
- `server-only` module (allows importing server-only modules in tests).
- `@/lib/env.client` (provides test values for all `NEXT_PUBLIC_` vars).
- `@/lib/env.server` (provides test values for `SUPABASE_SERVICE_ROLE_KEY`,
  `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`).

`vitest.config.ts` added coverage paths:
- `src/lib/social/**` (Instagram service).
- `src/components/dashboard/**` (all dashboard widgets).
- Updated coverage thresholds: lines 90%, functions 90%, branches 85%,
  statements 90%.

---

## Consequences

### Positive

- **Dashboard is now a functional hub** — members see the Instagram profile,
  notifications, and upcoming events without navigating away from the home page.
- **Instagram profile always visible** even without API credentials — the avatar
  (logo), name, @username, and follow button provide meaningful Instagram
  presence without requiring any API configuration.
- **No fake data shown to production users** — `getCachedInstagramPosts()`
  returns an empty array when the cache is empty, and
  `getInstagramProfile()` returns stat counts of `0` which the UI hides.
  Mock data exists only in test files and `getMockInstagramPosts()`.
- **OAuth redirect now reliable** — `getCallbackOrigin()` prioritizes
  `NEXT_PUBLIC_SITE_URL` and the callback route writes cookies directly onto
  the response object, fixing the "successful exchange but redirected back to
  login" bug.
- **OAuth diagnostic logging** across the callback route, middleware, and
  sign-in button enables server-side debugging of session issues via Vercel
  deployment logs.
- **Self-service error messages** on `/auth/auth-code-error` help
  administrators diagnose and fix redirect URL misconfiguration without
  developer intervention.
- **`images.unsplash.com` CSP fix** prevents image-blocking errors for
  Instagram mock data in test environments.
- **Server-only Instagram service** — the `server-only` import prevents
  accidental client-side bundling of credentials.
- **RLS is correctly scoped** — authenticated users can only read cached posts;
  writes require the admin client, preventing data contamination.
- **Consistent SectionHeader pattern** — all dashboard sections share a common
  header rendering approach, simplifying future widget additions.
- **19 new unit tests** validate Instagram mock data shape, notification widget
  interaction, and calendar event rendering logic.
- **Test infrastructure updated** — env mocks and coverage paths are ready for
  future sprints.

### Negative

- **No Instagram posts on the dashboard** — the post grid was removed in favor
  of the profile-only display. Posts are only shown when real API credentials
  are configured and posts are cached in the database. There is no built-in
  cache refresh mechanism in this sprint.
- **`InstagramPostCard` and `InstagramFeed` components exist but are unused**
  — they were created in the initial sprint commit but are not imported by
  `dashboard-content.tsx`. They remain available for a future refactor.
- **`CalendarWidget` server component exists but is unused** — the calendar
  section is rendered inline in `DashboardContent`. The component is available
  for a future refactor toward server-component-only dashboard sections.
- **Notifications are entirely mock-based** — no persistence, no server-side
  fetching, no integration with a notifications module. "Mark all as read" is
  client-side only and resets on page refresh.
- **`fetchAndCacheInstagramPosts()` is not called automatically** — must be
  invoked by an external scheduled job (cron) or admin action.
- **Instagram posts upsert is row-by-row** — `fetchAndCacheInstagramPosts()`
  loops over each post and calls `supabase.from("instagram_posts").upsert()`
  individually. For large batches this is slower than a bulk upsert.
- **Calendar fetches all future events** even though only 5 are shown —
  `listEvents()` with `{ from: now }` returns all future events, then
  `.slice(0, 5)` limits rendering.

### Neutral

- **All user-facing strings remain in Spanish**, consistent with the rest of
  the application.
- **The `InstagramFeed` and `CalendarWidget` server components** are available
  for a future refactor that moves toward server-component-only dashboard
  sections.
- **Sprint 4 depends on Sprint 1** (UI/UX) for the AppShell layout, feed
  container design, and existing component patterns.
- **The notifications module is deferred to Sprint 15** — the mock
  implementation is explicitly temporary, with clear comments marking this.
- **OAuth diagnostic logs are verbose** — every middleware request and every
  callback invocation produces multiple `console.log` statements. These may be
  noisy in development but provide essential debugging data for session issues.

---

## File Manifest

### New files

| File | Purpose |
|---|---|
| `supabase/migrations/20260101002500_instagram_posts.sql` | Migration 0025: creates `umsuka.instagram_posts` cache table with RLS policies |
| `src/lib/social/instagram.ts` | Instagram service: `getInstagramProfile()`, `fetchAndCacheInstagramPosts()`, `getCachedInstagramPosts()`, `getInstagramPosts()`, `getMockInstagramPosts()`, mock data, `InstagramProfile` and `InstagramPost` type definitions |
| `src/components/dashboard/section-header.tsx` | Reusable `SectionHeader` component with title, optional icon, and optional action |
| `src/components/dashboard/instagram-post-card.tsx` | `InstagramPostCard` — single post thumbnail with hover overlay, video indicator, and external link (created but not currently imported) |
| `src/components/dashboard/instagram-feed.tsx` | Server component `InstagramFeed` — fetches and renders Instagram posts in a responsive grid (created but not currently imported) |
| `src/components/dashboard/notifications-widget.tsx` | `"use client"` `NotificationsWidget` — mock notifications with "Mark all as read" |
| `src/components/dashboard/calendar-widget.tsx` | Server component `CalendarWidget` — fetches `listEvents()` and displays upcoming events with badges (created but not currently imported) |
| `src/app/dashboard/dashboard-content.tsx` | `"use client"` `DashboardContent` — main dashboard layout with welcome banner, Instagram profile card, notifications, upcoming events, and session info |
| `tests/unit/lib/social/instagram.test.ts` | 10 unit tests for `getMockInstagramPosts()` — shape, limits, URL validation, timestamps |
| `tests/unit/components/dashboard/notifications-widget.test.tsx` | 7 unit tests for `NotificationsWidget` — rendering, unread badge, mark-all-read click behavior |
| `tests/unit/components/dashboard/calendar-widget.test.tsx` | 2 import tests + 5 logic tests for `CalendarWidget` — event filtering, formatting, empty state |

### Modified files

| File | Change |
|---|---|
| `src/app/dashboard/page.tsx` | Refactored from simple welcome card to server component that fetches Instagram profile and events in parallel and passes them to `DashboardContent` |
| `src/lib/supabase/server.ts` | Improved comment in `setAll` catch block explaining why Server Component cookie writes are silently ignored |
| `src/components/layout/google-signin-button.tsx` | Added `getCallbackOrigin()` prioritizing `NEXT_PUBLIC_SITE_URL` over `window.location.origin`; added `useRef` guard against double-clicks; added browser console logging of callback URL |
| `src/app/auth/callback/route.ts` | Added diagnostic cookie logging before/after code exchange; added post-exchange session verification; enhanced missing-code error with origin/SITE_URL details and setup suggestion |
| `src/lib/supabase/middleware.ts` | Added `[middleware] getUser result:` diagnostic logging with pathname, user ID, error details, and cookie count |
| `src/app/auth/auth-code-error/page.tsx` | Enhanced `missing_code` error message with concrete setup instructions for localhost and production redirect URLs |
| `next.config.ts` | Added `images.unsplash.com` to `images.remotePatterns` and to CSP `img-src` directive |
| `.env.example` | Expanded `NEXT_PUBLIC_SITE_URL` comment with Supabase redirect URL configuration instructions and examples |
| `src/types/database.types.ts` | Added `instagram_posts` table row type definition matching the new schema |
| `src/lib/env.server.ts` | Added `INSTAGRAM_ACCESS_TOKEN` and `INSTAGRAM_USER_ID` (both optional) with backwards compatibility fallback to `NEXT_PUBLIC_` variants |
| `vitest.config.ts` | Added coverage include paths for `src/lib/social/**` and `src/components/dashboard/**` |
| `tests/setup/vitest.setup.ts` | Added mocks for `server-only`, `@/lib/env.client`, and `@/lib/env.server` modules with test values for Instagram env vars |
