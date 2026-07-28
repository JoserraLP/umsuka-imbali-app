# Environment Variables

## Local development

Copy `.env.example` to `.env.local` and fill in your Supabase project's
values (Project Settings → API in the Supabase dashboard).

| Variable | Scope | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public (client + server) | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (client + server) | Supabase anonymous/public API key. Safe to expose; access is governed by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Bypasses RLS. Used only by `src/lib/supabase/admin.ts`, imported exclusively from trusted server code. Never expose to the browser |
| `NEXT_PUBLIC_SITE_URL` | Public (client + server) | Base URL used to build the OAuth redirect URL (`http://localhost:3000` locally, your production domain on Vercel) |

Public values are validated in `src/lib/env.client.ts` and the service
role key in `src/lib/env.server.ts` (kept in **separate modules on
purpose**: importing one must never trigger validation of the other,
otherwise a page that only needs the public URL would crash because the
service-role key isn't present in that context, or vice versa). Both fail
fast with a clear error at import time instead of a confusing runtime
failure later.

> **Note:** `.env.local` is only read by your local Next.js process — it
> is git-ignored and never uploaded to Vercel. For deployed environments
> (Production/Preview), set these same variables in the Vercel dashboard
> (Project → Settings → Environment Variables) or via `vercel env add`.

## Google OAuth setup (Supabase Auth)

1. In Google Cloud Console, create an OAuth 2.0 Client ID (Web application).
2. Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`.
3. In the Supabase dashboard: Authentication → Providers → Google → paste
   the Client ID / Secret, enable the provider.
4. For local development with the Supabase CLI, set
   `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` in your shell
   environment before `supabase start` (referenced from `supabase/config.toml`).
5. Google sign-in is the **only** authentication method — no password or
   magic-link provider is enabled, per project requirements.

## CI / Vercel secrets

Configure these as GitHub Actions repository secrets (Settings → Secrets
and variables → Actions) and as Vercel project environment variables:

| Secret | Used by |
|---|---|
| `SUPABASE_URL` | `test.yml`, `build.yml`, `deploy.yml` |
| `SUPABASE_ANON_KEY` | `test.yml`, `build.yml`, `deploy.yml` |
| `SUPABASE_SERVICE_ROLE_KEY` | `test.yml`, `build.yml`, `deploy.yml` |
| `SITE_URL` | `test.yml`, `build.yml`, `deploy.yml` |
| `VERCEL_TOKEN` | `deploy.yml` |
| `VERCEL_ORG_ID` | `deploy.yml` |
| `VERCEL_PROJECT_ID` | `deploy.yml` |
| `SUPABASE_ACCESS_TOKEN` | `deploy.yml` (applies migrations via `supabase db push`) |
| `SUPABASE_PROJECT_REF` | `deploy.yml` (links the CLI to the production project) |

Recommended: use a dedicated Supabase **staging** project for CI runs
(`test.yml`/`build.yml`) that is distinct from the production project
migrations are pushed to in `deploy.yml`.
