# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo.

## 1. Keep it simple (the first rule)

Do the **minimum needed** for the task and nothing more. Simple code, simple
logic, no redundancy, no speculative abstraction; reuse `@ate/shared` and
`@ate/design` before writing anything new; **no new dependencies without
lead sign-off**. When two approaches work, the smaller one wins. Full detail in
[`CONVENTIONS.md`](./CONVENTIONS.md) ("What simple means here").

## 2. Contribution policy

Two long-lived branches: **`main` is production, `dev` is development.** Every
feature is developed on a feature branch cut from `dev` and merged into `dev`
via a reviewed pull request; production ships through a separate `dev` → `main`
release PR. Never commit or push directly to either (neither is protected on
GitHub; this is discipline, not tooling). PR rules and branch naming in
[`CONVENTIONS.md`](./CONVENTIONS.md); the issue workflow below sets the branch
name. What each environment maps to is in
[`docs/architecture.md`](./docs/architecture.md) §Operations reference.

## 3. Issues are the only task record

GitHub issues are the single record of ALL work — there is no spec file or
Notion board.

- **Before building anything**, check open issues (`gh issue list`); if the
  work isn't there, create it (`gh issue create` — plain-language title,
  milestone `Demo MVP` or `Customer MVP`, labels only where one already
  exists: `bug`, `documentation`).
- **To learn how something was built**, search closed issues:
  `gh issue list --state closed --search "..."` — closed issues are the
  knowledge base, each pointing at the code paths involved.
- Branches: `feature/<issue#>-<short-desc>`. PR body includes `Fixes #N`.

## 4. Where to look

| What you need | Where |
|---|---|
| What the product is and how it is meant to work | [`docs/product.md`](./docs/product.md) |
| How the system is wired, seams, hosting, ops reference | [`docs/architecture.md`](./docs/architecture.md) |
| Tables, RLS, envelope/event fields | [`docs/data-model.md`](./docs/data-model.md) |
| Ideas we might build, known gaps, things ruled out | [`docs/future.md`](./docs/future.md) |
| Env vars: what and where to obtain | `apps/web/.env.example`, `apps/worker/.env.example` |
| Code/naming/error-handling/PR/dependency rules | [`CONVENTIONS.md`](./CONVENTIONS.md) |
| How to write comments, docs, issues, PR bodies | [`CONVENTIONS.md`](./CONVENTIONS.md) §Writing |
| Orientation, repo map, getting started | [`README.md`](./README.md) |

## 5. Agent-specific rules

- **Verify before claiming done.** Run `pnpm lint && pnpm typecheck && pnpm build`
  at the root and confirm green before saying a change works. For UI, load the
  affected route (`pnpm dev`).
- **Design system.** In `apps/web`, import components by subpath
  (`@ate/design/components/Button`), not the barrel.
- **Write less.** Comments say why, not what; don't restate what the docs
  already cover; a change that removes functionality must not add comment lines.
  Issues and PRs state the problem, impact, and how to verify — nothing else.
  Full rules in [`CONVENTIONS.md`](./CONVENTIONS.md) §Writing.
- **Contracts need sign-off.** Changing a `packages/shared` seam signature
  requires lead sign-off (see [`CONVENTIONS.md`](./CONVENTIONS.md) §Contracts;
  the seams are described in [`docs/architecture.md`](./docs/architecture.md)).
- **Two auth/Vercel footguns, learned the hard way:**
  - GET route handlers must never have side effects — production Link prefetch
    *executes* them (a GET /logout once wiped sessions right after login).
    Anything mutating must be a POST.
  - Enforce auth in `lib/supabase/middleware.ts`, not with page-level
    `redirect()` — a redirect inside a prefetched server component poisons the
    client router cache.
