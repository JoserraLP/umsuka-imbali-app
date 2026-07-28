# ADR-001: Sprint 1 — Mejora de Interfaz Gráfica (UI/UX)

**Status:** Accepted · **Date:** 2026-07-28

---

## Context

Sprint 1 implements a complete visual redesign of the Umsuka Imbali App
interface, moving from a simple card-based layout to a modern social-media
inspired design (X/Twitter style). Before this sprint, all authenticated pages
used a uniform pattern: a centered `<main>` wrapper with a horizontal
`DashboardNav` bar at the top, a `ThemeToggle` in the header, and content in
ShadCN `Card` components.

The existing UI had several limitations:

- **No persistent sidebar** — navigation was a horizontal scrollable bar,
  making it hard to see all options at a glance.
- **No mobile-optimized navigation** — the same horizontal nav was used on
  all screen sizes, with no bottom navigation for mobile users.
- **No feed-style layout** — content was displayed in isolated cards without
  a continuous feed pattern common in social apps.
- **Inconsistent visual hierarchy** — all pages had different max-widths
  (some `max-w-3xl`, others `max-w-5xl`, `max-w-2xl`) with no shared
  container strategy.
- **Generic color scheme** — the default ShadCN blue primary color had no
  relation to the association's branding.

The project follows a component-based architecture with ShadCN UI primitives,
Tailwind CSS for styling, and next-themes for dark/light mode (already
installed). Design tokens are defined via CSS custom properties in
`globals.css` and extended in `tailwind.config.ts`.

Architecture and deployment context are documented in `docs/ARCHITECTURE.md`
and `docs/DATABASE.md`.

---

## Decision

### Design Tokens (`tailwind.config.ts`, `globals.css`)

**Color palette** shifted to brand colors:

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--primary` / `--ring` / `--brand` | `#0369b4` (hsl 205 97% 36%) | `#0369b4` (hsl 205 97% 50%) | Primary buttons, links, active indicators |
| `--secondary` | `#efdb03` (hsl 55 98% 47%) | `#baaa03` (hsl 55 90% 40%) | Secondary badges, accents |
| `--sidebar-*` | White bg, light gray hover | Dark bg, subtle brand active | Sidebar chrome |
| `--background` / `--foreground` | White / near-black | Near-black / white | Page base |

**New CSS custom properties** for the sidebar system:

| Property | Purpose |
|---|---|
| `--sidebar` | Sidebar background |
| `--sidebar-foreground` | Sidebar text |
| `--sidebar-muted` | Sidebar muted areas |
| `--sidebar-hover` | Hover state background |
| `--sidebar-active` | Active nav item background |

**Custom animations** added in `tailwind.config.ts`:

- `animate-fade-in` — 200ms opacity fade
- `animate-slide-up` — 300ms translateY + opacity
- `animate-slide-in-right` — 200ms translateX + opacity

**Utility classes** in `globals.css`:

- `.feed-container` — centered wrapper with `max-w-[600px]` (X/Twitter feed width)
- `.sidebar-link` — rounded-full nav item with consistent padding and transition
- `.nav-icon` — 24x24 icon sizing

### Layout Architecture

```
┌─────────────────────────────────────────────┐
│  Sidebar (≥md)           │  Main Content     │
│  ┌──────────────────┐    │  ┌─────────────┐  │
│  │ Logo + Brand     │    │  │ Page Content │  │
│  │──────────────────│    │  │ (feed-width) │  │
│  │ • Inicio         │    │  │             │  │
│  │ • Eventos        │    │  │             │  │
│  │ • Calendario     │    │  │             │  │
│  │ • Mi perfil      │    │  │             │  │
│  │ • Historial      │    │  │             │  │
│  │ • Miembros¹      │    │  │             │  │
│  │──────────────────│    │  └─────────────┘  │
│  │ User card        │    │                   │
│  │ Theme + Logout   │    │                   │
│  └──────────────────┘    │                   │
└─────────────────────────────┴─────────────────┘
┌─────────────────────────────────────────────┐
│  Bottom Nav (<md)                           │
│  [Inicio] [Eventos] [Calendario] [Perfil]   │
└─────────────────────────────────────────────┘
```

¹ Visible only for management roles.

**Three new layout components** in `src/components/layout/`:

| Component | Type | Responsibility |
|---|---|---|
| `app-shell.tsx` | Server component wrapper | Combines sidebar + bottom-nav + feed container; adds `md:pl-sidebar` and `pb-16` (mobile bottom nav space) |
| `sidebar.tsx` | Client component (`usePathname`) | Fixed left sidebar on desktop (`≥md`); nav links with active detection, user info card, theme toggle, logout |
| `bottom-nav.tsx` | Client component (`usePathname`) | Fixed bottom nav on mobile (`<md`); icon + label per visible link |

**Nav link configuration** (`nav-links.ts`):

All navigation routes are centralized in a `NAV_LINKS` array with icons
(Lucide React), labels, and optional `showFor` guards for role-based
visibility. The `isLinkActive()` helper resolves active state correctly even
when a parent and child route are both in the nav (e.g., `/profile` and
`/profile/history`), preventing both from appearing active simultaneously.

### Feed Components (`src/components/feed/`)

| Component | Sub-components | Purpose |
|---|---|---|
| `avatar.tsx` | — | Circular avatar with image (`next/image`) or initial-letter fallback; sizes sm/md/lg/xl |
| `post-card.tsx` | `PostCardHeader`, `PostCardContent`, `PostCardActions` | Social-media post card with border-bottom separator; supports `onClick` for interactive cards |
| `feed-list.tsx` | — | Wrapper with `rounded-xl border bg-card` and `divide-y`; shows `emptyMessage` fallback when empty |
| `follow-button.tsx` | — | Toggle button with "Seguir" / "Siguiendo" states; `rounded-full` pill style |

### Page Refactoring

All 8 authenticated pages were refactored to use `<AppShell profile={profile}>`
as their outer wrapper, removing duplicated `<main>`, `DashboardNav`,
`ThemeToggle`, and header boilerplate:

| Page | Key changes |
|---|---|
| `dashboard/page.tsx` | Replaced card-based welcome with feed-style layout using `animate-fade-in`; removed `ThemeToggle` and `DashboardNav` |
| `events/page.tsx` | Moved "Nuevo evento" and "Calendario" buttons to header area; uses feed-container width |
| `events/[id]/page.tsx` | Event title and back link in a `border-b` header; cards remain for forms/panels |
| `events/new/page.tsx` | Same pattern as event detail; back link restored |
| `calendar/page.tsx` | Calendar card preserved; header simplified |
| `profile/page.tsx` | Profile form card with header |
| `profile/history/page.tsx` | Two-card layout for attendance/absence tables |
| `admin/users/page.tsx`| Member directory table; header with description |
| `admin/users/[id]/page.tsx` | Edit member with role/status cards |

### Page Header Pattern

Each page now follows a consistent structure within the AppShell:

```tsx
<AppShell profile={profile}>
  <div className="animate-fade-in space-y-4">
    <div className="border-b border-border pb-4">
      <h1 className="text-xl font-bold tracking-tight">Page Title</h1>
      <p className="mt-1 text-sm text-muted-foreground">Description.</p>
      {backLink && (
        <Link ...>← Volver</Link>
      )}
    </div>
    {/* Page-specific content */}
  </div>
</AppShell>
```

### Active Link Detection Bug Fix

The original `startsWith`-based active detection caused both `/profile` and
`/profile/history` to appear active when visiting the history page. Fixed
by introducing `isLinkActive()` in `nav-links.ts`, which checks whether a
more specific nav link matches the current pathname before declaring a
parent route active.

### Logo & Favicon

- **Sidebar logo** — loads `/logo.png` (user-provided) with a "U" letter
  fallback if the image fails to load.
- **Browser favicon** — SVG "U" letter on brand-blue background
  (`/icons/icon.svg`), with `/favicon.ico` as legacy fallback.
- **PWA manifest** — updated `theme_color` and `background_color` to
  `#0369b4`; icons point to the SVG.

---

## Consequences

### Positive

- **Consistent social-media layout** across all authenticated pages —
  sidebar on desktop, bottom nav on mobile, feed-width content.
- **Navigation is always visible** — the sidebar stays fixed on desktop;
  the bottom bar stays fixed on mobile. No more horizontal scrolling nav.
- **Mobile-first responsive design** — bottom nav adapts to touch targets;
  content fills the full width on small screens.
- **Active link detection is correct** — parent/child routes in the nav
  (e.g., `/profile` and `/profile/history`) no longer conflict.
- **Brand colors are now applied** — primary `#0369b4` (blue) and secondary
  `#efdb03` (yellow) give the app a distinct identity.
- **Reusable feed components** — `PostCard`, `FeedList`, `Avatar`, and
  `FollowButton` are ready for future sprints (Instagram feed, news feed,
  etc.).
- **Shared nav configuration** — adding a new nav link requires only one
  entry in `NAV_LINKS`, with optional role gating.
- **Build and all 95 tests pass** with no regressions.

### Negative

- **The login page (`/auth/login`) was NOT refactored** — it remains outside
  AppShell, which is correct (unauthenticated users shouldn't see the
  sidebar), but means there are now two visual "modes" (public vs.
  authenticated).
- **Sidebar and bottom-nav are client components** — they use `usePathname`
  and cannot be server components. The `AppShell` wrapper is a server
  component, so the client boundary starts at Sidebar/BottomNav.
- **The SVG favicon may not render in all browsers** — some older browsers
  (IE, older Safari) require `.ico`. The `favicon.ico` fallback is provided.

### Neutral

- **All user-facing strings remain in Spanish.**
- **The `public/icons/` directory was removed and recreated** — the SVG
  favicon is now the primary icon source.
- **The `DashboardNav` component still exists** but is no longer imported
  by any page. It can be removed in a future cleanup sprint.

---

## File Manifest

### New files

| File | Purpose |
|---|---|
| `src/components/layout/nav-links.ts` | Centralized nav link definitions with role visibility and `isLinkActive()` |
| `src/components/layout/sidebar.tsx` | Desktop sidebar with nav, user info, theme toggle, logout |
| `src/components/layout/bottom-nav.tsx` | Mobile bottom navigation bar |
| `src/components/layout/app-shell.tsx` | Layout wrapper combining sidebar + bottom-nav + feed container |
| `src/components/feed/avatar.tsx` | Avatar component with image/fallback for sm/md/lg/xl |
| `src/components/feed/post-card.tsx` | PostCard with Header, Content, Actions sub-components |
| `src/components/feed/feed-list.tsx` | Feed list container with empty state |
| `src/components/feed/follow-button.tsx` | Follow/unfollow toggle button |
| `public/icons/icon.svg` | SVG favicon: "U" letter on brand-blue background |

### Modified files

| File | Change |
|---|---|
| `tailwind.config.ts` | Added sidebar colors, brand colors, animations, font family, spacing, extended border radii |
| `src/app/globals.css` | Updated CSS variables for brand colors, added `.feed-container`, `.sidebar-link`, `.nav-icon` utilities |
| `src/app/layout.tsx` | Added `icons` metadata with favicon/ICO; updated `themeColor` to brand blue |
| `public/manifest.json` | Updated `theme_color`, `background_color` to `#0369b4`; updated icons to SVG |
| `src/components/layout/sidebar.tsx` | Added logo image loading with fallback to "U" |
| `src/components/layout/bottom-nav.tsx` | Updated to use `isLinkActive()` for correct active detection |
| `src/app/dashboard/page.tsx` | Refactored to use `<AppShell>`; new feed-style layout |
| `src/app/events/page.tsx` | Refactored to use `<AppShell>`; moved action buttons to header |
| `src/app/events/[id]/page.tsx` | Refactored to use `<AppShell>`; new header pattern |
| `src/app/events/new/page.tsx` | Refactored to use `<AppShell>`; added back link |
| `src/app/calendar/page.tsx` | Refactored to use `<AppShell>` |
| `src/app/profile/page.tsx` | Refactored to use `<AppShell>` |
| `src/app/profile/history/page.tsx` | Refactored to use `<AppShell>` |
| `src/app/admin/users/page.tsx` | Refactored to use `<AppShell>` |
| `src/app/admin/users/[id]/page.tsx` | Refactored to use `<AppShell>` |
