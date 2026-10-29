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
  channel     text not null check (channel in ('email', 'slack', 'voice', 'heartbeat')),
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
