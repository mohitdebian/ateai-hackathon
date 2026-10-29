Fixes #

## What and why

<!-- The problem and its impact. One or two sentences. -->

## How to verify

<!-- The steps a reviewer runs to see it work. -->

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm build` pass
- [ ] New migration uses a timestamp prefix (`supabase migration new <name>`)
- [ ] New required env var added to `.env.example` **and** `scripts/required-env.json`, and set in Vercel + Cloud Run for the target environment
- [ ] Vendor-side setup done where the code assumes it (webhook, app config, scheduler)

<!-- dev → main only: confirm the change has run on dev, and that prod-only
     config (env vars, webhooks, scheduler jobs) exists on the prod side. -->
