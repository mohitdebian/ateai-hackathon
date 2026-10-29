# ate.ai Digital Workforce

An invitation-only platform where a company writes a job description, an AI
employee is created and configured, trained, given access to that company's
systems, hired into an org chart, and then works through whichever channels the
company uses — observable on a dashboard.

- What & why, scope → [`docs/product.md`](./docs/product.md)
- How it's wired (with diagram), hosting, operations → [`docs/architecture.md`](./docs/architecture.md)
- Developer onboarding (URLs, API keys, webhooks, setup) → [`docs/onboarding.md`](./docs/onboarding.md)
- Tables and contracts → [`docs/data-model.md`](./docs/data-model.md)
- Maybes, known gaps, and things ruled out → [`docs/future.md`](./docs/future.md)
- Work tracking: **GitHub issues only** — open = remaining, closed = the record
  of what shipped and how. Anything not committed to is in `docs/future.md`,
  not an issue.

## Layout

```
apps/
  web/        Next.js dashboard + API routes + inbound webhooks (Vercel)
  worker/     Node service running employee turns (Cloud Run)
packages/
  design/     @ate/design — extracted design system (tokens, fonts, components)
  shared/     @ate/shared — message envelope, identity file, seam interfaces
supabase/     migrations + seed
docs/         product / architecture / data-model / future reference
```

## Prerequisites

- Node >= 20 (repo developed on 25)
- pnpm 10 (`corepack enable` or `npm i -g pnpm`)

## Getting started

```bash
pnpm install       # install all workspaces
pnpm dev           # run the web app (http://localhost:3000)
pnpm build         # build every workspace
pnpm lint          # eslint across the repo
pnpm typecheck     # tsc --noEmit per package
```

Vendor keys are **not** required to run the web shell or the worker locally —
services stub out when unconfigured. When you need real services, copy
`apps/web/.env.example` to `apps/web/.env.local` and fill it; each var's
comment says where to obtain it (the worker's env is `apps/worker/.env.example`).

## Local Docker E2E

With Docker Desktop, the Supabase CLI, and both local env files configured:

```sh
./scripts/local-e2e.sh
```

This starts local Supabase, rebuilds the worker container, and starts the web
app. Use `./scripts/local-e2e.sh stop` to stop both local services.

For real vendor flows, expose only `http://localhost:3000` through a stable,
developer-specific HTTPS tunnel. Create a disposable employee through that
hostname, install its sandbox Slack app, create an AgentMail `message.received`
webhook for that inbox, and make a Vapi call. Use sandbox Composio accounts,
then confirm inbound, tool, and outbound events in local Supabase and test a
second message for Mem0 recall. Do not reset the local database until external
resources are removed; their IDs are needed for cleanup.

## Contributing

Read [`CLAUDE.md`](./CLAUDE.md) and [`CONVENTIONS.md`](./CONVENTIONS.md) first.
Feature branches + reviewed PRs only — never commit directly to `main`.
