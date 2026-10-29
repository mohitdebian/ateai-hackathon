# Data model

Live schema is in `supabase/migrations/` (source of truth); generated types in
`packages/shared/src/database.ts`. This doc defines the model and the fields
that carry meaning. Both projects' ledgers are complete — 0001–0003 were
applied by hand but have since been recorded, so `schema_migrations` matches
the live schema in each (verified 2026-08-25).

## Migrations

**Create new ones with `supabase migration new <name>`**, which writes a
timestamp prefix. The existing `00NN_` files keep their numbers — they are
already applied, and renaming them makes the CLI treat them as new. Sequential
numbers are not used again: the CLI tracks by number, so two branches picking
the same one make it mark the second as applied without running it, leaving the
ledger claiming a column that Postgres does not have (#218, #232).

**CI applies them** (`.github/workflows/migrate.yml`): a migration landing on
`dev` is pushed to the dev database, one landing on `main` to prod. The branch →
database map is an allowlist, so any other branch fails instead of guessing.

`db push` refuses a migration that sorts *before* one already applied, which is
what a renumbering leaves behind. The workflow deliberately does not pass
`--include-all` to force those through: check the live schema first (the object
may already exist, in which case repair the ledger with `supabase migration
repair` rather than re-running the file), then apply it by hand.

Prod trails dev by design — it receives a migration when `dev` merges to `main`,
never before, so the schema never runs ahead of the code that uses it.

## Tables

| Table | Key columns |
|---|---|
| `organizations` | id, name, plan |
| `users` | id (= auth.users.id), org_id, name, email — profile row per authenticated user |
| `memberships` | user_id, org_id, role (`admin` / `manager` / `viewer`) |
| `employees` | id, org_id, name, avatar_url, hired_at (timestamptz, null = unhired draft — migration 0010, replacing the old status enum and its permanently-stuck `provisioning` rows, #92), manager_id (human user), identity (jsonb — the soul file). Carries no connector columns: every channel and app lives in the two tables below (#250) |
| `knowledge_docs` | id, org_id, employee_id, title, content chunk, embedding `vector(1024)` (Voyage voyage-3.x — change provider and dimension together) |
| `org_connectors` | id, org_id, provider, credential (jsonb, null = our own vendor account), config (jsonb), status (`active` / `pending` / `expired`) — what a client has turned on |
| `employee_connectors` | id, org_id, employee_id, provider, address, credential (jsonb), config (jsonb), status — what one employee has |
| `events` | id, org_id, employee_id, channel, kind (`message` / `tool` / `subagent`), payload (jsonb), created_at |
| `webhook_events` | provider, event_key (primary key together) — a delivered webhook's claim, so a redelivery is ignored rather than run twice (migration 0018) |
| `rate_limits` | bucket, window_start, count — fixed-window counters behind the `check_rate_limit` function (migration 0018) |

Notes:

- `employees.manager_id` identifies the human platform user who manages the
  employee; the manager rule is validated at hire.
- `knowledge_docs` retrieval goes through the `match_knowledge` RPC
  (migration 0002): SECURITY DEFINER with explicit org/employee scoping, since
  the worker calls it with the service role. Migration 0012 adds a
  `p_min_score` relevance floor (cosine, default 0.4, tunable with
  `KNOWLEDGE_MIN_SCORE`), so a low-signal turn retrieves nothing rather than
  the top N of whatever exists.
- Recall memory lives outside Postgres, keyed and scoped by
  employee_id-as-agent (`employees.id` is globally unique, so no org scope
  is needed).
- **Connectors** (#250). One shape for every way an employee reaches the
  outside world, replacing the seven `slack_*` columns, `email_address`,
  `vapi_assistant_id`, the `connections` table, and the singleton
  `slack_config_token` row. `packages/shared/src/connectors.ts` is the registry:
  one entry per connector recording its direction, identity, credential source,
  and how it is reached, plus the shapes of the two JSON columns. Adding a
  connector is an entry there and a handler (`apps/web/lib/connectors`,
  `apps/worker/src/deliver.ts`) — no migration.
  - `address` is how the outside world reaches an employee there: inbox id for
    AgentMail, app id for Slack, assistant id for Vapi, the number itself for a
    Vapi phone number. It is an indexed column
    rather than a key in `config` because every inbound message resolves through
    `(provider, address)` — uniquely, so the lookup cannot pick at random.
  - A connector needs BOTH rows to work: the org row says the client has it
    turned on, the employee row says this employee holds it. Deleting the org
    row takes a toolkit off every employee's next turn without touching their
    rows.
  - `status` distinguishes never-set-up from broken: `pending` is a Slack app
    nobody has installed yet, `expired` a revoked Composio grant (#206). Only
    `active` rows are routed to or attached to a turn.
- `webhook_events` and `rate_limits` are platform bookkeeping, not tenant data.
  They carry no `org_id`, RLS denies every non-service-role query, and
  `check_rate_limit` is granted to the service role alone.

## Envelope

The normalized inbound message every channel produces
(`packages/shared/src/envelope.ts`):

| Field | Meaning |
|---|---|
| `org_id` | Tenant |
| `employee_id` | Which employee the message is for |
| `channel` | `email` / `slack` / `voice` / `heartbeat` |
| `text` | The message content (email body, Slack text, call transcript, heartbeat prompt) |

A worker `TurnRequest` is the envelope plus an optional `delivery` descriptor
telling the worker how to reply on the originating channel (thread ts, inbox
id, etc.); without it the turn runs synchronously and returns `{ reply }`.

## Event payloads

`events.kind` decides the payload shape:

- `message` — `{ direction: "inbound" | "outbound" | "system", text, counterparty?, acted?, usage? }`;
  both directions carry `counterparty` when the turn had one (#43, #171), and
  outbound rows carry `usage: { input, output }` token counts. Heartbeat
  outbound rows carry `acted: boolean` — whether the check-in used any tools —
  which decides if the note appears in later recent-conversation windows (#174).
  `direction: "system"` rows are degradation notices (#118) with a `degraded`
  source tag, never conversation.
- `tool` — `{ tool, input, successful, error, duration_ms }`, one row per tool call in the loop, logged once the call completes (#120).

## Tenancy / RLS

Every tenant row carries `org_id`. RLS policies (migration 0001) block
cross-org reads for authenticated users; the worker uses the service role and
enforces scoping explicitly in its queries and in `match_knowledge`. The two
bookkeeping tables above are the exception — they hold no tenant data and are
reachable only by the service role.

`org_connectors` is the third exception, and the reason connectors are two
tables rather than one with a nullable `employee_id`: an org credential (the
Slack App Configuration Token today, Workspace delegation later) can reach a
customer's whole workspace, so the table carries RLS with **no policies at all**
— every non-service-role query is denied. `employee_connectors` needs the
opposite, since the profile page shows an employee's address, so it gets the
ordinary members-read / admin-manager-write pair. Two simple policies instead of
one security-critical policy with a condition in it.

`employee_connectors` is also column-restricted: tenant roles can read and write
only `id, org_id, employee_id, provider, address, config, status, created_at`.
The `credential` column — Slack app secrets and Composio account ids — is
reachable by the service role alone, the same as `org_connectors`. Tenant
queries must project explicit columns; `select *` and credential-based filters
fail.
