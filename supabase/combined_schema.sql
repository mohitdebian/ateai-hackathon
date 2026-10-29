-- ate.ai Digital Workforce — Tier 1 schema (docs/data-model.md).
-- One migration: extensions, tables, indexes, RLS helpers, RLS policies.
-- Every row carries org_id; RLS blocks cross-org reads (docs/data-model.md "Tenancy / RLS").
--
-- Embeddings: knowledge_docs.embedding is vector(1024) to match Voyage AI
-- (voyage-3.x, Anthropic's recommended embeddings partner). If you embed with a
-- different model, change the dimension here and in the train pipeline
-- (packages/shared/src/embeddings.ts).

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  plan       text not null default 'free',
  created_at timestamptz not null default now()
);

-- Profile row per authenticated user. id === auth.users.id.
-- org_id is the user's home org; cross-org membership lives in `memberships`.
create table users (
  id         uuid primary key references auth.users(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text,
  email      text,
  created_at timestamptz not null default now()
);

create table memberships (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  role       text not null default 'viewer' check (role in ('admin', 'manager', 'viewer')),
  created_at timestamptz not null default now(),
  unique (user_id, org_id)
);

create table employees (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  name              text not null,
  avatar_url        text,
  status            text not null default 'draft'
                    check (status in ('draft', 'provisioning', 'active', 'paused')),
  -- Manager rule (docs/product.md "Vision"): exactly one manager, human (users.id) or ai (employees.id).
  -- Polymorphic target, so no FK; validated at hire.
  manager_type      text check (manager_type in ('human', 'ai')),
  manager_id        uuid,
  identity          jsonb not null default '{}'::jsonb,  -- the soul file (IdentityFile)
  email_address     text,
  slack_bot_id      text,
  vapi_assistant_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One row per knowledge chunk; we store the chunk text alongside its
-- embedding so the retriever can return it directly.
create table knowledge_docs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  title       text not null,
  content     text not null,
  chunk_index int not null default 0,
  embedding   vector(1024),
  created_at  timestamptz not null default now()
);

create table connections (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  employee_id        uuid not null references employees(id) on delete cascade,
  provider           text not null,
  composio_account_id text,
  scope              text,
  created_at         timestamptz not null default now(),
  unique (employee_id, provider)
);

-- Append-only action log; also powers the dashboard activity rail
-- (docs/data-model.md "Event payloads").
create table events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  channel     text not null check (channel in ('email', 'slack', 'voice', 'heartbeat', 'web')),
  kind        text not null check (kind in ('message', 'tool', 'subagent')),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index employees_org_idx        on employees (org_id);
create index knowledge_docs_emp_idx   on knowledge_docs (employee_id);
create index connections_emp_idx      on connections (employee_id);
create index events_org_created_idx   on events (org_id, created_at desc);
create index events_emp_created_idx   on events (employee_id, created_at desc);
create index memberships_user_idx     on memberships (user_id);
-- Approximate-nearest-neighbour index for knowledge retrieval (cosine).
create index knowledge_docs_embedding_idx
  on knowledge_docs using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- RLS helpers (security definer: they read memberships regardless of caller RLS)
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.org_id = target_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(target_org uuid, roles text[])
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.org_id = target_org and m.user_id = auth.uid() and m.role = any(roles)
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS: every table is org-scoped. Reads require membership; writes require an
-- admin/manager role. The service role (worker, provisioning, signup) bypasses
-- RLS and is responsible for scoping by org_id itself.
-- ---------------------------------------------------------------------------

alter table organizations  enable row level security;
alter table users          enable row level security;
alter table memberships    enable row level security;
alter table employees      enable row level security;
alter table knowledge_docs enable row level security;
alter table connections    enable row level security;
alter table events         enable row level security;

-- organizations: members read their own org.
create policy org_select on organizations
  for select using (is_org_member(id));

-- users: read your own profile and teammates in a shared org.
create policy users_select on users
  for select using (id = auth.uid() or is_org_member(org_id));

-- memberships: read your own memberships and those of your orgs.
create policy memberships_select on memberships
  for select using (user_id = auth.uid() or is_org_member(org_id));

-- employees: members read; admin/manager write.
create policy employees_select on employees
  for select using (is_org_member(org_id));
create policy employees_write on employees
  for all using (has_org_role(org_id, array['admin', 'manager']))
  with check (has_org_role(org_id, array['admin', 'manager']));

-- knowledge_docs: members read; admin/manager write.
create policy knowledge_select on knowledge_docs
  for select using (is_org_member(org_id));
create policy knowledge_write on knowledge_docs
  for all using (has_org_role(org_id, array['admin', 'manager']))
  with check (has_org_role(org_id, array['admin', 'manager']));

-- connections: members read; admin/manager write.
create policy connections_select on connections
  for select using (is_org_member(org_id));
create policy connections_write on connections
  for all using (has_org_role(org_id, array['admin', 'manager']))
  with check (has_org_role(org_id, array['admin', 'manager']));

-- events: members read (the dashboard activity rail). Writes come from the
-- worker via the service role, so no member-write policy is granted.
create policy events_select on events
  for select using (is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Keep employees.updated_at fresh.
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger employees_touch_updated_at
  before update on employees
  for each row execute function public.touch_updated_at();
-- Knowledge retrieval. Cosine-similarity search over an employee's
-- knowledge chunks. Called by the worker's KnowledgeRetriever at turn start
-- with the query embedding (docs/architecture.md "The flow").
--
-- SECURITY DEFINER + explicit org/employee scoping: the worker calls this via
-- the service role, so the function itself enforces the tenant boundary.

create or replace function public.match_knowledge(
  p_org uuid,
  p_employee uuid,
  query_embedding vector(1024),
  match_count int default 5
)
returns table (doc_id uuid, title text, content text, score float)
language sql stable security definer set search_path = public as $$
  select
    id as doc_id,
    title,
    content,
    1 - (embedding <=> query_embedding) as score
  from knowledge_docs
  where org_id = p_org
    and employee_id = p_employee
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_knowledge(uuid, uuid, vector, int) from public;
grant execute on function public.match_knowledge(uuid, uuid, vector, int) to service_role;
-- Per-employee Slack apps (docs/architecture.md "Slack").
-- Each employee gets its own Slack app, created via the manifest API at hire.
-- The app's credentials live on the employee row: the webhook verifies
-- signatures with slack_signing_secret (looked up by api_app_id), the OAuth
-- install callback stores slack_bot_token, and the worker posts replies with it.
-- (Tokens in table columns is the MVP tradeoff — service-role writes only;
-- moving them to a secrets store is Tier 2 hardening, issue #30.)

alter table employees
  add column slack_app_id        text,
  add column slack_client_id     text,
  add column slack_client_secret text,
  add column slack_signing_secret text,
  add column slack_bot_token     text;

create index employees_slack_app_id_idx on employees (slack_app_id)
  where slack_app_id is not null;
-- 0004: single-use nonce for the Slack install OAuth state param (#33).
-- The hire route writes a fresh random nonce here when it hands out an
-- install link; the OAuth callback authenticates by matching it (on an
-- employee with no bot token yet) and clears it after the exchange.
alter table employees add column slack_install_state text;
-- Slack App Configuration Token, with automatic rotation (#48).
--
-- Creating an employee's Slack app calls apps.manifest.create, which needs an
-- App Configuration Token. Slack expires those after 12h, so the previous
-- hand-pasted SLACK_CONFIG_TOKEN env var broke every hire past that window.
-- Slack pairs each config token with a refresh token; tooling.tokens.rotate
-- mints a fresh access token and a NEW refresh token (the chain rotates), so
-- the refresh token must live somewhere writable — an env var cannot work.
--
-- SINGLETON, deliberately not org-scoped: this is ate.ai's own credential for
-- ate.ai's Slack workspace, not tenant data. Every employee app for every
-- customer is created in our workspace and (once public distribution is on,
-- #31) installed into theirs — customers never have their own config token.
-- `id boolean primary key default true check (id)` makes "at most one row" a
-- database guarantee.
--
-- Secrets in table columns is the same MVP tradeoff as 0003 (service-role
-- writes only); moving Slack secrets to a secrets store is #30.

create table slack_config_token (
  id            boolean primary key default true check (id),
  refresh_token text not null,
  access_token  text,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);

-- No policies: RLS on with zero policies denies every non-service-role query,
-- so this platform credential is unreachable from tenant-scoped requests.
alter table slack_config_token enable row level security;
-- 0006: hiring is now one continuous flow, no draft employees (#38).
-- Guarded with if exists/conditional checks since prior renumbering (#69)
-- left some environments with stale constraint-name stamps.
update employees set status = 'provisioning' where status = 'draft';

alter table employees alter column status drop default;

alter table employees drop constraint if exists employees_status_check;

alter table employees
  add constraint employees_status_check
  check (status in ('provisioning', 'active', 'paused'));

alter table employees alter column status set default 'provisioning';
-- 0007: drop `tone` from the soul file (#38 follow-up). Persona already covers how an
-- employee communicates, so an LLM-generated tone was duplicative context on every turn.
-- Removed from IdentityFile; this strips it from rows written before that change.
update employees set identity = identity - 'tone' where identity ? 'tone';
-- 0008: recurring tasks and daily responsibilities were the same thing (#47).
-- Fold any recurring_tasks values onto daily_responsibilities, then drop the key.
--
-- Both arms are type-guarded because employees.identity defaults to '{}'::jsonb
-- (0001_tier1_schema.sql) — a row can carry the key with a non-array value, and
-- `||` on a non-array silently produces garbage rather than erroring.
update employees
set identity = (identity - 'recurring_tasks') || jsonb_build_object(
  'daily_responsibilities',
  case when jsonb_typeof(identity->'daily_responsibilities') = 'array'
       then identity->'daily_responsibilities' else '[]'::jsonb end
  ||
  case when jsonb_typeof(identity->'recurring_tasks') = 'array'
       then identity->'recurring_tasks' else '[]'::jsonb end
)
where identity ? 'recurring_tasks';
-- 0009: drop `voice_profile` from the soul file (#94). It was never read — neither
-- prompt builder nor the Vapi channel consumed it, and the wizard only ever sent a
-- hardcoded default. Persona already covers how an employee sounds.
-- Removed from IdentityFile; this strips it from rows written before that change.
update employees set identity = identity - 'voice_profile' where identity ? 'voice_profile';
-- 0010: `status` collapsed real hire state into a value that could get stuck
-- forever (#92) — a failed hire left the row in `provisioning` with no way
-- back, and old `draft` rows migrated straight into the same bucket (0006).
-- Replace it with a plain timestamp: null means unhired, set means hired.
alter table employees add column hired_at timestamptz;

-- Backfill from created_at, not updated_at: the touch trigger (0001) stamps
-- updated_at on every edit, so it drifts to "last edited", while created_at is
-- at worst a few minutes before the hire (the wizard is one continuous run).
-- The true hire time was never recorded, so this is the closest stable bound.
update employees set hired_at = created_at where status = 'active';

alter table employees drop constraint if exists employees_status_check;

alter table employees drop column status;
-- Stream new execution-history events to authenticated employee-profile viewers.
alter publication supabase_realtime add table public.events;
-- Relevance floor for knowledge retrieval (#104). Migration 0002 returned the
-- top `match_count` chunks however bad the match, so "thanks!" still pulled the
-- whole handbook into the system prompt. With a floor the count can be
-- generous: ask for more, get back only what clears the bar. The worker passes
-- p_min_score from KNOWLEDGE_MIN_SCORE so it's tunable without a migration.
--
-- Dropped and recreated, not CREATE OR REPLACE: the argument list changes, so
-- Postgres treats it as a different function and the grants must be re-issued.

drop function if exists public.match_knowledge(uuid, uuid, vector, int);

create function public.match_knowledge(
  p_org uuid,
  p_employee uuid,
  query_embedding vector(1024),
  match_count int default 12,
  p_min_score float default 0.4
)
returns table (doc_id uuid, title text, content text, score float)
language sql stable security definer set search_path = public as $$
  select
    id as doc_id,
    title,
    content,
    1 - (embedding <=> query_embedding) as score
  from knowledge_docs
  where org_id = p_org
    and employee_id = p_employee
    and embedding is not null
    and 1 - (embedding <=> query_embedding) >= p_min_score
  order by embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_knowledge(uuid, uuid, vector, int, float) from public;
grant execute on function public.match_knowledge(uuid, uuid, vector, int, float) to service_role;
-- 0013: auto-enable RLS on every new public table.
--
-- Tenancy here is RLS: every row carries org_id and a policy blocks cross-org
-- reads (0001). A migration that adds a table but forgets
-- `alter table ... enable row level security` ships that table world-readable
-- through the anon key, and nothing fails — the bug is invisible until someone
-- looks. This event trigger closes that gap: any new table in `public` gets RLS
-- turned on the moment it is created.
--
-- It enables RLS and stops there. RLS with no policy denies everyone, so a
-- forgotten policy surfaces immediately as "no rows" instead of as a leak —
-- loud, not silent.
--
-- An equivalent function was created by hand on the original Supabase project
-- and lived in no migration, so a second project did not get it (#177). This
-- migration is the canonical definition; it is idempotent, so it both installs
-- the trigger where it is missing and adopts the hand-made one where it exists.

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = public as $$
declare
  obj record;
begin
  for obj in
    select * from pg_event_trigger_ddl_commands()
    where command_tag = 'CREATE TABLE' and schema_name = 'public'
  loop
    execute format('alter table %s enable row level security', obj.object_identity);
  end loop;
end;
$$;

-- `create event trigger` has no `or replace`, so drop first to stay idempotent.
drop event trigger if exists rls_auto_enable_trigger;

create event trigger rls_auto_enable_trigger
  on ddl_command_end
  when tag in ('CREATE TABLE')
  execute function public.rls_auto_enable();

revoke all on function public.rls_auto_enable() from public;
-- AI managers are no longer supported (#201). Existing rows that pointed at an
-- AI manager cannot be reassigned safely, so leave them unassigned rather than
-- retaining a polymorphic id that the application would treat as a user id.
update employees set manager_id = null where manager_type = 'ai';

update employees
set identity = jsonb_set(
  identity,
  '{manager}',
  jsonb_build_object('id', coalesce(manager_id::text, '')),
  true
);

alter table employees drop column if exists manager_type;
-- Production hardening: durable webhook claims and service-role auth limits.

create table webhook_events (
  provider   text not null check (provider in ('slack', 'agentmail', 'vapi')),
  event_key  text not null,
  created_at timestamptz not null default now(),
  primary key (provider, event_key)
);

create table rate_limits (
  bucket       text primary key,
  window_start timestamptz not null default now(),
  count        int not null default 1
);

-- ponytail: fixed window; use a sliding window only if boundary bursts matter.

-- These are platform bookkeeping tables. Service-role code is their only caller.
alter table webhook_events enable row level security;
alter table rate_limits enable row level security;

grant select, insert, update, delete on webhook_events, rate_limits to service_role;

create function public.check_rate_limit(p_bucket text, p_limit int, p_window interval)
returns boolean
language plpgsql
set search_path = public as $$
declare
  allowed boolean;
begin
  if p_limit < 1 or p_window <= interval '0' then
    raise exception 'rate limit and window must be positive';
  end if;

  insert into rate_limits as limits (bucket)
  values (p_bucket)
  on conflict (bucket) do update
  set
    count = case
      when limits.window_start <= now() - p_window then 1
      else limits.count + 1
    end,
    window_start = case
      when limits.window_start <= now() - p_window then now()
      else limits.window_start
    end
  returning count <= p_limit into allowed;

  return allowed;
end;
$$;

revoke all on function public.check_rate_limit(text, int, interval) from public;
grant execute on function public.check_rate_limit(text, int, interval) to service_role;
-- Local/CI Postgres never gets the anon/authenticated/service_role table
-- grants a hosted Supabase project receives automatically at creation (same
-- drift class as 0013's hand-made trigger): every table here is owner-only
-- until granted, so `authenticated` gets "permission denied" even though RLS
-- policies exist. RLS restricts which rows a role sees; these grants are what
-- let the role touch the table at all. Without this, 0018's rls_test.sql
-- cannot run against a freshly migrated database (only the original, by-hand
-- hosted project happens to have these already).
--
-- Table/sequence grants only — functions are deliberately excluded. 0018
-- already revokes public.check_rate_limit from everyone but service_role and
-- the RLS suite asserts authenticated/anon can't call it; a blanket function
-- grant here would silently re-open that.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to anon, authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
-- Every connector stored the same way (#250).
--
-- Before this, each vendor had its own shape: seven `slack_*` columns plus a
-- singleton `slack_config_token` row, one column each for email and voice, and
-- the `connections` table for Composio. Adding a connector cost a migration,
-- nothing could be enabled per client, and nothing carried a status.
--
-- Two tables replace all of it. They are two, not one with a nullable
-- employee_id, because the credentials have different blast radii: an org
-- credential (the Slack App Configuration Token today, Workspace delegation
-- later) can reach a customer's whole workspace and must be unreachable from
-- any tenant request, while an employee row must be readable by its org so the
-- profile page can show its address. Two simple policies beat one
-- security-critical policy with a condition in it.
--
-- Secrets stay in table columns, as they were (#30 moves them to a secrets
-- store); this change deliberately does not widen that.
--
-- Deploy note: this breaks both ways — the old code cannot read the new tables
-- and the new code cannot read the dropped columns — so this migration and the
-- web deploy have to land together, which merging the PR does. Expect webhook
-- 500s for the minute or so between the two; Slack, svix and Vapi all redeliver,
-- so nothing is lost. The whole file runs in one transaction, so a failure
-- leaves the old schema intact rather than a half-migrated one.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table org_connectors (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  provider   text not null,
  credential jsonb,                            -- null = our own vendor account
  config     jsonb not null default '{}'::jsonb,
  status     text not null default 'active' check (status in ('active', 'pending', 'expired')),
  created_at timestamptz not null default now(),
  unique (org_id, provider)
);

-- `config` is not null so no reader has to handle a null one. The cost is that a
-- PostgREST *bulk* write fills a key missing from one row with null rather than
-- the default, so batch rows that share a key set, or write them one at a time.
create table employee_connectors (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  provider    text not null,
  address     text,                            -- inbound routing key
  credential  jsonb,
  config      jsonb not null default '{}'::jsonb,
  status      text not null default 'active' check (status in ('active', 'pending', 'expired')),
  created_at  timestamptz not null default now(),
  unique (employee_id, provider)
);

create index employee_connectors_org_idx on employee_connectors (org_id);

-- Unique rather than a plain index: every inbound message resolves through
-- (provider, address), and two employees answering the same address would make
-- that lookup pick one at random. Partial because Composio rows carry no
-- address, and Postgres treats nulls as distinct anyway.
create unique index employee_connectors_route_idx
  on employee_connectors (provider, address)
  where address is not null;

-- ---------------------------------------------------------------------------
-- Data moves
-- ---------------------------------------------------------------------------
-- `distinct on` throughout: the unique route index would abort this whole
-- migration on a duplicate address, and a schema left unmigrated under already
-- deployed code is far worse than dropping one stale duplicate row.

insert into employee_connectors (org_id, employee_id, provider, address)
select distinct on (email_address) org_id, id, 'agentmail', email_address
from employees
where email_address is not null
order by email_address, created_at;

-- `address` is the app id, not the bot id: that is what every inbound Slack
-- event carries (`api_app_id`), and the address column exists to be the routing
-- key. The bot id only backs the profile's "Open in Slack" link, so it is
-- config. A row with no app id was never routable and is not carried over.
insert into employee_connectors (org_id, employee_id, provider, address, credential, config, status)
select distinct on (slack_app_id)
  org_id,
  id,
  'slack',
  slack_app_id,
  nullif(jsonb_strip_nulls(jsonb_build_object(
    'client_secret',  slack_client_secret,
    'signing_secret', slack_signing_secret,
    'bot_token',      slack_bot_token
  )), '{}'::jsonb),
  jsonb_strip_nulls(jsonb_build_object(
    'client_id',     slack_client_id,
    'bot_id',        slack_bot_id,
    'install_state', slack_install_state
  )),
  case when slack_bot_token is not null then 'active' else 'pending' end
from employees
where slack_app_id is not null
order by slack_app_id, created_at;

insert into employee_connectors (org_id, employee_id, provider, address)
select distinct on (vapi_assistant_id) org_id, id, 'vapi', vapi_assistant_id
from employees
where vapi_assistant_id is not null
order by vapi_assistant_id, created_at;

-- Composio last, and skipping conflicts: a toolkit slug can collide with a
-- native provider (Composio has a `slack` toolkit). The native connector wins —
-- it is the one the webhooks route through.
insert into employee_connectors (org_id, employee_id, provider, credential, status)
select
  org_id,
  employee_id,
  provider,
  nullif(jsonb_strip_nulls(jsonb_build_object('composio_account_id', composio_account_id)), '{}'::jsonb),
  case when scope = 'expired' then 'expired' else 'active' end
from connections
on conflict (employee_id, provider) do nothing;

-- What each org has turned on. Every org gets the three native connectors,
-- because that is what every org has today — hire provisions all of them and
-- there is no way to turn one off. Deciding this per client is #243/#251; this
-- migration must not quietly take voice away from an org that has not hired yet.
insert into org_connectors (org_id, provider)
select o.id, p.provider
from organizations o, (values ('agentmail'), ('slack'), ('vapi')) as p(provider)
on conflict (org_id, provider) do nothing;

-- Plus every Composio toolkit its employees already hold a grant for.
insert into org_connectors (org_id, provider)
select distinct org_id, provider from employee_connectors
on conflict (org_id, provider) do nothing;

-- The Slack App Configuration Token moves from its singleton table onto each
-- org's `slack` row. It is per (Slack user, workspace) and rotates on every use
-- — rotating one copy invalidates the others — so orgs sharing this copied pair
-- is a stopgap: the first to rotate keeps working and the rest fail loudly at
-- the next hire until seeded with their own pair (#235, #240). That is the
-- point of moving it: the credential now has somewhere per-org to live.
insert into org_connectors (org_id, provider, credential)
select
  o.id,
  'slack',
  jsonb_strip_nulls(jsonb_build_object(
    'refresh_token', t.refresh_token,
    'access_token',  t.access_token,
    'expires_at',    to_jsonb(t.expires_at)
  ))
from organizations o, slack_config_token t
on conflict (org_id, provider) do update set credential = excluded.credential;

-- ---------------------------------------------------------------------------
-- The old shapes
-- ---------------------------------------------------------------------------

drop index if exists employees_slack_app_id_idx;

alter table employees
  drop column email_address,
  drop column slack_bot_id,
  drop column slack_app_id,
  drop column slack_client_id,
  drop column slack_client_secret,
  drop column slack_signing_secret,
  drop column slack_bot_token,
  drop column slack_install_state,
  drop column vapi_assistant_id;

drop table connections;
drop table slack_config_token;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- 0013's event trigger already enabled RLS on both tables at create time; these
-- are here so the file states its own security posture rather than depending on
-- a trigger three migrations back.

alter table org_connectors      enable row level security;
alter table employee_connectors enable row level security;

-- org_connectors: no policies at all, like slack_config_token before it. RLS on
-- with zero policies denies every non-service-role query, so an org credential
-- is unreachable from a tenant-scoped request.

-- employee_connectors: members read, admin/manager write — the same grant the
-- `slack_*` columns had on `employees`, so this is not a widening.
create policy employee_connectors_select on employee_connectors
  for select using (is_org_member(org_id));
create policy employee_connectors_write on employee_connectors
  for all using (has_org_role(org_id, array['admin', 'manager']))
  with check (has_org_role(org_id, array['admin', 'manager']));

-- Grants, stated rather than inherited. 0019's default privileges cover
-- `authenticated` and `anon` on tables created after it, but nothing in this
-- repo grants `service_role` — a hosted Supabase project happens to, a local or
-- CI one does not (the same drift 0013 and 0019 record, and why 0018 grants its
-- own tables by hand). org_connectors is reachable by no other role, so leaving
-- this to the platform would make a missing grant silently break every hire.
grant select, insert, update, delete on employee_connectors to authenticated;
grant select on employee_connectors to anon;
grant select, insert, update, delete on org_connectors, employee_connectors to service_role;
insert into org_connectors (org_id, provider)
select distinct org_id, 'composio:all'
from org_connectors
where provider not in ('agentmail', 'slack', 'vapi', 'vapi_phone')
  and status = 'active'
on conflict (org_id, provider) do nothing;
-- #223: tenant roles must not read connector credentials.
-- RLS hides other orgs' rows, but every org member can still read its own
-- org's credential JSON (Slack secrets, Composio account ids). Column
-- privileges keep tenant access on the metadata columns; only the service
-- role and the table owner can touch `credential`. Table-level grants go
-- first: revoking a column cannot override a table grant.

revoke select, insert, update on public.employee_connectors
  from public, anon, authenticated;

grant select (id, org_id, employee_id, provider, address, config, status, created_at)
  on public.employee_connectors to anon, authenticated;

grant insert (org_id, employee_id, provider, address, config, status),
      update (org_id, employee_id, provider, address, config, status)
  on public.employee_connectors to authenticated;
