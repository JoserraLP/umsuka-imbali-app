# Umsuka Imbali App

Management platform for a carnival association: Members, Events,
Attendance, Absences, Work Shifts, News, Questions, Voting, Documents,
Notifications and Administration.

> **Status.** Technical foundation ✅ · Sprint 2 (Profiles & RBAC) ✅ ·
> Sprint 3 (Events + Calendar) ✅ · Sprint 4 (Registrations) ✅ · Sprint 5
> (Attendance & Absences), Sprint 6 (Shifts) — pending, to be implemented
> sequentially.

## Implemented modules

| Module | Routes | Notes |
|---|---|---|
| Authentication | `/auth/login`, `/auth/callback`, `/auth/auth-code-error` | Google OAuth only |
| Dashboard | `/dashboard` | Landing page after login |
| Profiles (Sprint 2) | `/profile` | View/edit own profile (name, birth date, component type) |
| RBAC / Members (Sprint 2) | `/admin/users`, `/admin/users/[id]` | Directory + role assignment + full profile edit + activation ("alta"/"baja") toggle. Gated to management/admin roles for viewing; editing, role changes and activation are restricted to `admin`/`super_admin`, with least-privilege enforced (only `super_admin` can grant/revoke `super_admin`/`admin`, and no actor can deactivate their own account) |
| Events (Sprint 3) | `/events`, `/events/new`, `/events/[id]` | List, create, view, edit, delete. Read open to every authenticated member; write restricted to management roles (`board_member`, `event_manager`, `admin`, `super_admin`) |
| Calendar (Sprint 3) | `/calendar` | Month grid view of every event, colour-coded by type, with month navigation |
| Registrations (Sprint 4) | `/events/[id]` (registration panel) | Register/unregister for an event, with an atomic, race-safe capacity check (`umsuka.events.capacity`) and a management-visible attendee list with per-attendee removal |

## Stack

- **Frontend:** Next.js 15 (App Router), React 19, TypeScript, TailwindCSS, ShadCN UI, React Hook Form, Zod, TanStack Query
- **Backend/DB:** Supabase (PostgreSQL, Auth, Storage)
- **Auth:** Supabase Auth — Google OAuth only
- **Deployment:** GitHub → GitHub Actions → Vercel
- **Testing:** Vitest, React Testing Library, Playwright
- **Quality:** ESLint, Prettier, Husky, lint-staged

## Getting started

```bash
npm ci
cp .env.example .env.local   # fill in your Supabase project values
npm run supabase:start        # optional: local Supabase via Docker
npm run supabase:reset         # applies all migrations locally
npm run dev
```

The app runs at `http://localhost:3000` and redirects to `/auth/login`.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run lint` / `npm run lint:fix` | ESLint |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` / `npm run test:watch` / `npm run test:coverage` | Vitest |
| `npm run test:e2e` | Playwright |
| `npm run supabase:start` / `:stop` / `:reset` | Local Supabase via CLI |
| `npm run supabase:gen-types` | Regenerate `src/types/database.types.ts` from the live schema |

## Project structure

```
src/
  app/                  Routes, layouts, Route Handlers (delivery layer)
  components/
    ui/                 ShadCN primitives
    layout/              Composed layout/auth components
    providers/           Query & theme providers
  lib/
    supabase/            client / server / admin / middleware factories
    auth/                 roles, permissions (RBAC), session resolution
    env.ts                Zod-validated environment configuration
  types/                 Domain contracts (database, auth)
supabase/
  config.toml            Local CLI configuration
  migrations/             Schema, RLS, triggers (source of truth)
tests/
  unit/                  Vitest + React Testing Library
  e2e/                    Playwright
docs/
  ARCHITECTURE.md         Layered architecture, Mermaid diagrams
  DATABASE.md             ERD, migrations, RLS policy matrix
  ENVIRONMENT.md          Environment variables & OAuth setup
  DEPLOYMENT.md           CI/CD pipeline & Vercel/Supabase setup
```

See `docs/` for full architecture, database, environment and deployment
documentation.

## Database

All business tables live in the PostgreSQL schema **`umsuka`** — never
`public`. Row Level Security is enabled and forced on every table. See
`docs/DATABASE.md` for the entity-relationship diagram and the full RLS
policy matrix.

## Authentication

Google OAuth is the only sign-in method. A `umsuka.profiles` row is
created automatically via a database trigger the first time a user signs
in. Authorization is enforced independently at three layers: middleware
(UX-level route guard), server-side validation (Server Actions/Route
Handlers), and PostgreSQL RLS (the authoritative layer). See
`docs/ARCHITECTURE.md` for the full flow.

## CI/CD

Four GitHub Actions workflows (`.github/workflows/`): `lint.yml`,
`test.yml`, `build.yml` run on every PR into `develop`/`main`; `deploy.yml`
runs on every push to `main`, re-validates everything, then deploys to
Vercel and applies database migrations. See `docs/DEPLOYMENT.md`.

## Branching

```
feature/*  →  develop  →  main
```

`main` must always remain deployable.
