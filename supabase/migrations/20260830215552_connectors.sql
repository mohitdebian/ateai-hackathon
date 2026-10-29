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
