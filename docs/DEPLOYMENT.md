# Deployment

## Branch strategy

```
feature/*  →  develop  →  main
```

- `feature/*` — one branch per task, opened as a PR into `develop`.
- `develop` — integration branch. Every PR into it runs `lint.yml` and
  `test.yml` (unit + e2e) as required status checks.
- `main` — always deployable. Every PR into it runs the same checks;
  every **push** (i.e. merge) to `main` additionally triggers `deploy.yml`.

## Pipeline

```
GitHub → GitHub Actions → Validation → Vercel → Production
```

On every merge to `main`, `deploy.yml` runs two jobs in sequence:

1. **`validate`** — ESLint, TypeScript (`tsc --noEmit`), Vitest with
   coverage, and a production `next build`. Any failure stops the pipeline
   before anything reaches production.
2. **`deploy`** (only if `validate` succeeds) — builds and deploys to
   Vercel production via the Vercel CLI, then applies any pending
   PostgreSQL migrations to the linked Supabase project with
   `supabase db push`.

`lint.yml`, `test.yml`, and `build.yml` also run independently on every
pull request into `develop` or `main`, so problems are caught before merge
— `deploy.yml`'s `validate` job is a second, non-negotiable gate directly
in front of production.

## Vercel project setup

1. Import the GitHub repository into Vercel.
2. Framework preset: Next.js (auto-detected).
3. Set the four `NEXT_PUBLIC_*` / `SUPABASE_SERVICE_ROLE_KEY` environment
   variables (see `docs/ENVIRONMENT.md`) for the **Production** and
   **Preview** environments.
4. Disable Vercel's automatic Git integration deployments for `main` if you
   want `deploy.yml` to be the sole path to production (Project Settings →
   Git → Production Branch deployments), since GitHub Actions is
   responsible for gating the deploy on the validation job here.
   Alternatively, keep Vercel's Git integration for preview deployments on
   `feature/*`/`develop` and let `deploy.yml` own `main` exclusively.

## Supabase project setup

1. Create a Supabase project (production) and, optionally, a second one for
   CI/staging.
2. Run `supabase link --project-ref <ref>` locally once, then
   `supabase db push` to apply all migrations in `supabase/migrations/`.
3. Enable the Google provider under Authentication → Providers (see
   `docs/ENVIRONMENT.md`).
4. Add your Vercel production domain to Authentication → URL Configuration
   → Redirect URLs as `https://<your-domain>/auth/callback`.

## Rollback

Vercel retains every deployment. To roll back, promote a previous
deployment to production from the Vercel dashboard or CLI
(`vercel rollback`). Database migrations are additive/forward-only by
convention in this project — a schema rollback requires an explicit,
reviewed "down" migration rather than an automatic revert.
