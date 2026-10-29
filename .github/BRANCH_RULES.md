# Branch Strategy & Repository Rules

## Overview

We follow a two-tier release flow designed for safety and continuous delivery:

```
[feature/* / fix/*]  ──PR──>  [ dev ]  ──Release PR──>  [ main ]
                              (Testing)                 (Production)
```

---

## 1. Branch Roles

### `dev` (Development & Testing)
- **Role**: Continuous integration and integration testing environment.
- **Base for New Work**: All new features, bug fixes, and chores MUST branch from `dev`.
- **PR Target**: All developer PRs must target `dev`.
- **Automated Deploys**: Merges to `dev` trigger CI and deploy automatically to:
  - Worker: `ate-worker-dev` (Cloud Run)
  - Dashboard: Vercel Preview environment
  - Heartbeat: `ate-heartbeat-dev`
  - Supabase: Development database (`secrets.SUPABASE_DB_URL_DEV`)

### `main` (Production)
- **Role**: Stable production releases.
- **Source**: Receives code **only via release PRs from `dev`** (`dev` → `main`).
- **Never push directly to `main`**.
- **Automated Deploys**: Merges to `main` trigger CI, verify production environment variables, and deploy to:
  - Worker: `ate-worker-prod` (Cloud Run)
  - Dashboard: Vercel Production
  - Heartbeat: `ate-heartbeat`
  - Supabase: Production database (`secrets.SUPABASE_DB_URL_PROD`)

---

## 2. Branch Protection Rules

### Recommended GitHub Settings for `main`
- **Require a pull request before merging**:
  - Require approvals: 1
  - Dismiss stale pull request approvals when new commits are pushed
  - Require review from Code Owners
- **Require status checks to pass before merging**:
  - `check` (CI: lint, typecheck, tests, build)
  - `database` (Supabase schema reset & tests)
  - `env-check` (Production required env vars presence)
- **Require branches to be up to date before merging**
- **Do not allow bypassing the above settings**
- **Restrict who can push to matching branches**: No direct pushes; releases via PR only.

### Recommended GitHub Settings for `dev`
- **Require a pull request before merging**:
  - Require approvals: 1
  - Dismiss stale approvals on push
- **Require status checks to pass before merging**:
  - `check` (CI: lint, typecheck, tests, build)
  - `database` (Supabase schema verification)
  - `env-check` (Development required env vars presence)
- **Restrict direct pushes**

---

## 3. Pull Request Standards

1. **Naming Conventions**:
   - Features: `feature/<issue#>-<short-description>`
   - Bug fixes: `fix/<issue#>-<short-description>`
   - Maintenance: `chore/<short-description>`
2. **Commit Message Format**: Follow Conventional Commits (`feat: ...`, `fix: ...`, `chore: ...`, `refactor: ...`).
3. **Checklist Before Merge**:
   - `pnpm lint` passes with 0 errors.
   - `pnpm typecheck` passes across all monorepo workspaces.
   - `pnpm test` passes (all unit tests green).
   - `pnpm build` succeeds without type or bundle errors.
   - Any new migrations use timestamps (`supabase migration new <name>`).
   - Any new required environment variable is declared in `.env.example`, `scripts/required-env.json`, and configured in Cloud Run & Vercel.
