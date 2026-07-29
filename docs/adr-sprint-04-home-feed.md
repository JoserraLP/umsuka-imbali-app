# ADR-004: Sprint 4 — Página de Inicio / Dashboard (Home Feed)

**Status:** Accepted · **Date:** 2026-07-29

---

## Context

Sprint 4 redesigns the `/dashboard` home page to serve as a central hub for
members, transforming it from a simple welcome card into a three-section
dashboard that surfaces relevant information at a glance.

Before this sprint, the dashboard (`src/app/dashboard/page.tsx`) displayed a
single welcome card with the user's name, a role badge, and a logout button.
It was purely informational and did not provide any actionable content or
integration with external services.

Three functional gaps existed:

1. **No social media presence** — the association maintains an active
   Instagram account (@umsuka) but there was no way to surface posts within
   the app.
2. **No notification system** — the app had no concept of notifications.
   Members had no way to see recent updates, shift assignments, or absence
   approvals without navigating to specific pages.
3. **No calendar overview** — upcoming events were only visible by navigating
   to `/events` or `/calendar`. There was no at-a-glance view of what is
   coming next.

The project follows its established architecture patterns:
- Server components for data fetching, client components for interactivity
- Zod schemas for validation, queries/mutations for data access
- Supabase (PostgreSQL) with Row Level Security (RLS)
- Tailwind CSS with ShadCN UI primitives for styling

Architecture, database, and deployment context are documented in
`docs/ARCHITECTURE.md` and `docs/DATABASE.md`.

Previous ADRs: ADR-001 (Sprint 1 - UI redesign), ADR-002 (Sprint 2 - Workgroup
roles), ADR-005 (Sprint 5 - Attendance and Absences).

---

## Decision

### Dashboard Layout — CSS Grid with Responsive Sidebar

The dashboard uses a CSS Grid layout with two columns on desktop and a single
column on mobile:

```
┌──────────────────────────────────────────────────┐
│  Welcome Banner (full width)                      │
│  Nombre, rol, tipo de componente badges          │
├────────────────────────────┬─────────────────────┤
│  Instagram Feed            │  Notifications  (R) │
│  (responsive 1-2-3 col    │  (last 5 unread)    │
│   grid of post cards)      ├─────────────────────┤
│                            │  Calendar       (R) │
│                            │  (next 3-5 events)  │
│                            ├─────────────────────┤
│                            │  Session Card   (R) │
│                            │  (email + logout)   │
└────────────────────────────┴─────────────────────┘
```

- **Desktop** (`lg:`): `grid-cols-[1fr_380px]` — feed area takes remaining
  width, sidebar is fixed at 380px.
- **Mobile** (`<lg`): `grid-cols-1` — sections stack vertically.
- All sections share a common `rounded-xl border bg-card p-5` card style.
- A `SectionHeader` component provides a consistent title+icon+action pattern.

The layout is implemented in `dashboard-content.tsx` (a `"use client"` component
that receives pre-fetched data from the server page).

### Instagram Feed — Two-Tier Architecture (API + DB Cache)

**Instagram Basic Display API** is used to fetch posts from the association's
Instagram account. The integration follows a two-tier architecture:

1. **Fetch layer** (`src/lib/social/instagram.ts` — `fetchAndCacheInstagramPosts()`):
   - Calls `https://graph.instagram.com/v12.0/{userId}/media` with the access token.
   - Maps API response fields (`id`, `caption`, `media_url`, `permalink`,
     `media_type`, `timestamp`) to the application's `InstagramPost` type.
   - Upserts each post into the `umsuka.instagram_posts` cache table using the
     **admin client** (`createAdminClient()`) to bypass RLS for writes.
   - Uses `server-only` import to prevent any client-side bundling of the
     Instagram fetch logic.
   - Returns `false` if no real credentials are configured, signalling that
     mock data should be used.

2. **Read layer** (`src/lib/social/instagram.ts` — `getCachedInstagramPosts()`):
   - Reads from `umsuka.instagram_posts` using the **authenticated client**
     (`createClient()`), respecting RLS.
   - Orders by `timestamp DESC`, limited to 9 posts (configurable via `limit`
     parameter).
   - Falls back to `MOCK_POSTS` (9 hardcoded posts with Unsplash placeholder
     images) when the cache is empty or a DB error occurs.

3. **Public convenience function** (`getInstagramPosts(limit)`):
   - Thin wrapper around `getCachedInstagramPosts()` for use by page components.

The separation between fetch and read layers means:
- The API fetch only runs server-side (e.g., via a cron job or admin action).
- The read layer is fast (cached DB query) and respects RLS.
- In development without real credentials, mock data is transparently returned.

**API base URL**: `https://graph.instagram.com/v12.0` (hardcoded in `instagram.ts`).

**Media type mapping**:
| API value         | App value   |
|-------------------|-------------|
| `IMAGE`           | `image`     |
| `VIDEO`           | `video`     |
| `CAROUSEL_ALBUM`  | `carousel`  |

### Instagram Post Card (`instagram-post-card.tsx`)

A `"use client"` component that renders a single Instagram post as a linked
thumbnail card:

- Uses `next/image` with `fill` and `object-cover` for responsive images.
- `aspect-square` for uniform card proportions.
- **Video indicator**: A "VIDEO" badge (black/60 background) in the top-left
  corner when `mediaType === "video"`.
- **Hover overlay**: Dark gradient at the bottom with caption preview (2-line
  clamp) and an external link icon, both fading in on hover.
- Sizes attribute: `(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw`.
- Opens the Instagram post in a new tab with `target="_blank"` and
  `rel="noopener noreferrer"`.

### Instagram Feed Component (`instagram-feed.tsx`)

A **server component** alternative that fetches posts server-side and renders
the grid. Although created in this sprint, it is **not currently imported** by
`dashboard-content.tsx` — the Instagram section is inlined there instead. This
component remains available for future refactoring to a server-component-based
layout.

### Database Migration — `umsuka.instagram_posts`

Migration file: `supabase/migrations/20260101002500_instagram_posts.sql`

| Column      | Type            | Constraints                  | Purpose                         |
|-------------|-----------------|------------------------------|----------------------------------|
| `id`        | `serial`        | `PRIMARY KEY`                | Auto-incrementing PK             |
| `post_id`   | `text`          | `NOT NULL`, `UNIQUE`         | Instagram's native post ID       |
| `caption`   | `text`          | nullable                     | Post caption text                |
| `media_url` | `text`          | `NOT NULL`                   | URL of the image/video media     |
| `permalink` | `text`          | `NOT NULL`                   | Link to the Instagram post       |
| `media_type`| `text`          | `NOT NULL DEFAULT 'image'`,  `CHECK (media_type IN ('image', 'video', 'carousel'))` | Media type enum            |
| `timestamp` | `timestamptz`   | `NOT NULL`                   | Post creation timestamp          |
| `cached_at` | `timestamptz`   | `DEFAULT now()`              | When the post was cached          |

Index: `idx_instagram_posts_timestamp` on `timestamp DESC` for efficient
ordering queries.

RLS is enabled and forced:
- **SELECT**: `authenticated` role can read all rows (policy
  `instagram_posts_select_authenticated`).
- **INSERT/UPDATE/DELETE**: No policies for `authenticated` — writes are
  performed exclusively through the admin client (`createAdminClient()`), which
  bypasses RLS via the `service_role` key.

### Instagram Credentials — Environment Variables

Instagram API credentials are defined as **server-only** environment variables
in `src/lib/env.server.ts`, keeping them out of the browser bundle:

| Variable                    | Optional | Fallback                              |
|-----------------------------|----------|---------------------------------------|
| `INSTAGRAM_ACCESS_TOKEN`    | Yes      | `NEXT_PUBLIC_INSTAGRAM_ACCESS_TOKEN`  |
| `INSTAGRAM_USER_ID`         | Yes      | `NEXT_PUBLIC_INSTAGRAM_USER_ID`       |

**Backwards compatibility**: The Zod schema reads `INSTAGRAM_ACCESS_TOKEN` or
`NEXT_PUBLIC_INSTAGRAM_ACCESS_TOKEN` (and similarly for `USER_ID`), allowing
projects that previously defined the `NEXT_PUBLIC_` variants to continue working.

The `NEXT_PUBLIC_INSTAGRAM_*` variables were removed from
`src/lib/env.client.ts` during this sprint.

### Notifications Widget — Mock Data (Sprint 15+)

The `NotificationsWidget` is a `"use client"` component that displays up to
**5 notifications** from an in-memory mock data array (`generateMockNotifications()`
returns 6 items; `visibleNotifications` slices to 5).

**Mock notification types**:
- `Calendar` (blue) — new events, schedule changes
- `Users` (green) — shift assignments, absence approvals
- `Megaphone` (purple) — news publications
- `Clock` (amber) — attendance reminders

**Feature: "Mark all as read"** — a `CheckCheck` button appears when there are
unread notifications. Clicking it updates local state, setting all `read`
booleans to `true`. This is purely client-side (no persistence).

The mock data will be replaced in **Sprint 15** with real data from the
`umsuka.notifications` table. The component's `TODO` comment notes this.

### Calendar Widget — Live Data from `umsuka.events`

The `CalendarWidget` is an **async server component** that:

1. Calls `listEvents({ from: new Date().toISOString() })` to fetch future
   events from the `umsuka.events` table.
2. Limits display to 5 events (configurable via `limit` prop).
3. Shows each event with:
   - Title (truncated with `truncate` class)
   - Formatted date using `es-ES` locale with smart prefixes: "Hoy", "Mañana",
     or abbreviated weekday (`vie.`, `sáb.`, etc.) + day + month.
   - Event type badge (`Badge` component with color-coded variants:
     `general`=default, `meeting`=secondary, `carnival`=destructive,
     `work_shift`=outline).
   - "Ver todos" link to `/events`.
4. Empty state: Icon + "No hay próximos eventos" message.

**Dates**: The `CalendarWidget` and `DashboardContent` each contain a
`formatEventDate()` helper with slightly different implementations:
- `CalendarWidget` uses `new Date(now.getTime() + 86400000)` for "tomorrow"
  detection (arithmetic-based).
- `DashboardContent` uses `tomorrow.setDate(tomorrow.getDate() + 1)` (Date
  object-based). Both handle DST transitions correctly in their own way,
  but the duplication is noted as a future cleanup opportunity.

### Server-Side Data Fetching (`page.tsx`)

The dashboard page (`src/app/dashboard/page.tsx`) is a **server component** that:

1. Calls `getCurrentProfile()` — redirects to `/auth/login` if unauthenticated.
2. Fetches Instagram posts and upcoming events in **parallel** via `Promise.all()`:
   ```typescript
   const [posts, events] = await Promise.all([
     getInstagramPosts(9),
     listEvents({ from: new Date().toISOString() }),
   ]);
   ```
3. Passes data as props to the client component `DashboardContent`.

### Section Header Component (`section-header.tsx`)

A lightweight, reusable component shared by all three dashboard sections:

| Prop     | Type              | Purpose                        |
|----------|-------------------|--------------------------------|
| `title`  | `string`          | Section heading text           |
| `icon`   | `LucideIcon` (opt)| Icon displayed next to title   |
| `action` | `ReactNode` (opt) | Action element (link, button)  |

Renders a `border-b` header row with flex layout.

### Test Coverage

19 new unit tests were added across three test files:

| Test file | Tests | Scope |
|---|---|---|
| `tests/unit/lib/social/instagram.test.ts` | 10 | `getMockInstagramPosts` — array shape, default/custom limit, property types, URL validation, ISO 8601 timestamps, edge cases (limit=0, limit>available) |
| `tests/unit/components/dashboard/notifications-widget.test.tsx` | 7 | Component rendering, unread badge count, "Mark all read" click behavior (disappears badge + button), notification titles, max 5 items |
| `tests/unit/components/dashboard/calendar-widget.test.tsx` | 2 import tests + 5 logic tests | Module import validation, event label mapping, date formatting, future-event filtering, max-5 limit, empty state |

### Test Infrastructure Updates

**`tests/setup/vitest.setup.ts`** added mocks for:
- `server-only` module (allows importing server-only modules in tests).
- `@/lib/env.client` (provides test values for all `NEXT_PUBLIC_` vars).
- `@/lib/env.server` (provides test values for `SUPABASE_SERVICE_ROLE_KEY`,
  `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`).

**`vitest.config.ts`** added coverage paths:
- `src/lib/social/**` (Instagram service)
- `src/components/dashboard/**` (all dashboard widgets)
- Updated coverage thresholds: lines 90%, functions 90%, branches 85%,
  statements 90%.

---

## Consequences

### Positive

- **Dashboard is now a functional hub** — members see Instagram posts,
  notifications, and upcoming events without navigating away from the home page.
- **Instagram integration is production-ready** — the two-tier architecture
  (API fetch + DB cache) avoids rate-limiting issues and provides fast reads
  for every page load.
- **Mock data enables development without credentials** — the app works fully
  with no Instagram API configuration, ideal for local development and CI.
- **Server-only Instagram service** — the `server-only` import prevents
  accidental client-side bundling of the Instagram fetch logic and credentials.
- **Backwards-compatible env vars** — projects that previously used
  `NEXT_PUBLIC_INSTAGRAM_*` continue to work without changes.
- **RLS is correctly scoped** — authenticated users can only read cached posts;
  writes require the admin client, preventing data contamination.
- **Consistent SectionHeader pattern** — all three dashboard sections share a
  common header rendering approach, simplifying future widget additions.
- **Responsive grid layout** — 2-column on desktop, single column on mobile,
  with the feed area taking flexible width and the sidebar fixed at 380px.
- **19 new unit tests** validate Instagram mock data shape, notification widget
  interaction, and calendar event rendering logic.
- **Test infrastructure updated** — env mocks and coverage paths are ready for
  future sprints.

### Negative

- **Instagram feed uses an inline layout in `dashboard-content.tsx`** — the
  `InstagramFeed` server component (`instagram-feed.tsx`) exists but is not
  imported. The feed rendering logic is duplicated in the client component.
- **Duplicate `formatEventDate()` logic** — both `DashboardContent` and
  `CalendarWidget` implement the same formatting function with slightly
  different "tomorrow" detection (`setDate` vs. arithmetic). This is a
  maintenance hazard if the format needs to change.
- **Notifications are entirely mock-based** — there is no persistence, no
  server-side fetching, and no integration with a notifications module. The
  mock data has no connection to real user activity.
- **"Mark all as read" is client-side only** — refreshing the page resets all
  notifications to their unread state. No state is persisted to the database.
- **`fetchAndCacheInstagramPosts()` is not called automatically** — it must be
  invoked by an external scheduled job (cron) or admin action. There is no
  built-in cache refresh mechanism in this sprint.
- **No lazy loading or pagination** for Instagram posts — all 9 posts are
  fetched upfront each page load (though from the DB cache, not the API).
- **The `instagram_posts` upsert is row-by-row** — `fetchAndCacheInstagramPosts()`
  loops over each post and calls `supabase.from("instagram_posts").upsert()`
  individually. For large batches this is slower than a bulk upsert.
- **Calendar widget fetches all future events** even though only 5 are shown
  — `listEvents()` with `{ from: now }` returns all future events, then
  `.slice(0, 5)` limits rendering. This is a minor performance concern for
  large event catalogs.

### Neutral

- **All user-facing strings remain in Spanish**, consistent with the rest of
  the application.
- **The `InstagramFeed` server component** is available for a future refactor
  that moves toward server-component-only dashboard sections.
- **Sprint 4 depends on Sprint 1** (UI/UX) for the AppShell layout, feed
  container design, and existing component patterns.
- **The notifications module is deferred to Sprint 15** — the mock
  implementation is explicitly temporary, with clear comments marking this.

---

## File Manifest

### New files

| File | Purpose |
|---|---|
| `supabase/migrations/20260101002500_instagram_posts.sql` | Migration 0025: creates `umsuka.instagram_posts` cache table with RLS policies |
| `src/lib/social/instagram.ts` | Instagram service: `fetchAndCacheInstagramPosts()`, `getCachedInstagramPosts()`, `getInstagramPosts()`, `getMockInstagramPosts()`, mock data, type definitions |
| `src/components/dashboard/section-header.tsx` | Reusable `SectionHeader` component with title, optional icon, and optional action |
| `src/components/dashboard/instagram-post-card.tsx` | `InstagramPostCard` — single post thumbnail with hover overlay, video indicator, and external link |
| `src/components/dashboard/instagram-feed.tsx` | Server component `InstagramFeed` — fetches and renders Instagram posts in a responsive grid |
| `src/components/dashboard/notifications-widget.tsx` | `"use client"` `NotificationsWidget` — mock notifications with "Mark all as read" |
| `src/components/dashboard/calendar-widget.tsx` | Server component `CalendarWidget` — fetches `listEvents()` and displays upcoming events with badges |
| `src/app/dashboard/dashboard-content.tsx` | `"use client"` `DashboardContent` — main dashboard layout with welcome banner, Instagram grid, notifications sidebar, calendar, and session info |
| `tests/unit/lib/social/instagram.test.ts` | 10 unit tests for `getMockInstagramPosts()` — shape, limits, URL validation, timestamps |
| `tests/unit/components/dashboard/notifications-widget.test.tsx` | 7 unit tests for `NotificationsWidget` — rendering, unread badge, mark-all-read click behavior |
| `tests/unit/components/dashboard/calendar-widget.test.tsx` | 2 import tests + 5 logic tests for `CalendarWidget` — event filtering, formatting, empty state |

### Modified files

| File | Change |
|---|---|
| `src/app/dashboard/page.tsx` | Refactored from simple welcome card to server component that fetches Instagram posts and events in parallel and passes them to `DashboardContent` |
| `src/types/database.types.ts` | Added `instagram_posts` table row type definition matching the new schema |
| `src/lib/env.client.ts` | Cleaned up: removed `NEXT_PUBLIC_INSTAGRAM_ACCESS_TOKEN` and `NEXT_PUBLIC_INSTAGRAM_USER_ID` variables |
| `src/lib/env.server.ts` | Added `INSTAGRAM_ACCESS_TOKEN` and `INSTAGRAM_USER_ID` (both optional) with backwards compatibility fallback to `NEXT_PUBLIC_` variants |
| `.env.example` | Added `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`, and comment about backwards compatibility |
| `vitest.config.ts` | Added coverage include paths for `src/lib/social/**` and `src/components/dashboard/**` |
| `tests/setup/vitest.setup.ts` | Added mocks for `server-only`, `@/lib/env.client`, and `@/lib/env.server` modules with test values for Instagram env vars |
