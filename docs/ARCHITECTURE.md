# Architecture

## Overview

UMSUKA Imbali App follows a layered, Clean-Architecture-inspired structure on
top of the Next.js 15 App Router. Business modules (Events, Attendance,
Shifts, News, Questions, Voting, Documents, Administration) are added inside
this same structure — none of them change these boundaries.

```mermaid
flowchart TB
    subgraph Delivery["Delivery layer — src/app"]
        Pages["Pages & Route Handlers"]
        Middleware["middleware.ts (session refresh, route guard)"]
    end

    subgraph Presentation["Presentation layer — src/components"]
        UI["ui/ (ShadCN primitives)"]
        Layout["layout/ (composed components)"]
        Providers["providers/ (Query, Theme)"]
    end

    subgraph Application["Application layer — src/lib"]
        Auth["auth/ (roles, permissions, session)"]
        Supabase["supabase/ (client, server, admin, middleware)"]
        Env["env.ts (validated configuration)"]
    end

    subgraph Domain["Domain contracts — src/types"]
        DbTypes["database.types.ts"]
        AuthTypes["auth.ts"]
    end

    subgraph Infra["Infrastructure — Supabase"]
        PG["PostgreSQL (schema: umsuka)"]
        SupaAuth["Supabase Auth (Google OAuth)"]
        Storage["Supabase Storage"]
    end

    Pages --> Presentation
    Pages --> Application
    Middleware --> Application
    Presentation --> Application
    Application --> Domain
    Application --> Infra
```

## Boundary rules

1. **`src/app`** owns routing, layout composition and request/response
   concerns only. It must not contain SQL, RLS assumptions, or business
   rules beyond simple redirects/guards.
2. **`src/components`** is presentation-only. Server data fetching happens
   in Server Components/Server Actions; client components receive data as
   props or fetch through TanStack Query hooks that call Server Actions or
   Route Handlers.
3. **`src/lib`** is the application layer: Supabase client factories, auth
   session/role resolution, environment validation, and (as modules are
   added) use-case functions per domain (e.g. `lib/events/`,
   `lib/attendance/`). Each module's business logic belongs here, not in
   components or routes.
4. **`src/types`** holds domain contracts, kept framework-agnostic.
5. **`supabase/migrations`** is the single source of truth for schema
   changes. No table is ever created directly through the Studio UI in a
   way that isn't captured in a migration.

## Authentication & authorization flow

```mermaid
sequenceDiagram
    participant U as User
    participant B as Browser
    participant MW as middleware.ts
    participant SA as Supabase Auth
    participant DB as umsuka.profiles

    U->>B: Click "Sign in with Google"
    B->>SA: signInWithOAuth(google)
    SA->>U: Google consent screen
    U->>SA: Approve
    SA->>B: Redirect to /auth/callback?code=...
    B->>SA: exchangeCodeForSession(code)
    SA->>DB: (trigger) INSERT profile if new user
    SA-->>B: Session cookies set
    B->>MW: Request to /dashboard
    MW->>SA: getUser() (refresh session)
    MW-->>B: Allow (authenticated) / Redirect (not authenticated)
```

Authorization is enforced in three independent layers (defense in depth):

1. **Middleware** — redirects unauthenticated users away from protected
   routes. Convenience/UX only; never trusted for data access.
2. **Server validation** — Server Actions and Route Handlers re-check the
   session and role via `getCurrentProfile()` / `requireAdmin()` /
   `requireManagement()` before performing any mutation.
3. **Supabase RLS** — the last line of defense, enforced by PostgreSQL
   itself regardless of what the application layer does or fails to do.

## Deployment topology

```mermaid
flowchart LR
    Dev["feature/* branches"] -->|PR| Develop["develop"]
    Develop -->|PR| Main["main"]
    Main -->|push| GHA["GitHub Actions: deploy.yml"]
    GHA -->|validate| Validate["lint + typecheck + test + build"]
    Validate --> Vercel["Vercel (production)"]
    Validate --> SupaCLI["supabase db push"]
    Vercel --> Prod["Production (Next.js on Vercel)"]
    SupaCLI --> ProdDB["Production PostgreSQL (Supabase)"]
```
