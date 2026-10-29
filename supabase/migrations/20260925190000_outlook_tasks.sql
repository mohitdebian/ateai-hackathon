-- One durable item per Outlook connection setup or Inbox message. Composio
-- retries webhooks, and the worker can die after the webhook has been acked.
create table outlook_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  connected_account_id text not null,
  task_key text not null,
  message_id text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'acting', 'ignored', 'waiting', 'done', 'failed')),
  summary text,
  slack_channel text,
  slack_ts text,
  attempts integer not null default 0,
  error text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (connected_account_id, task_key),
  check ((task_key = 'setup' and message_id is null) or
         (message_id is not null and task_key = 'message:' || message_id) or
         task_key like 'reply:%' or
         (task_key like 'alert:%' and message_id is null))
);

create index outlook_tasks_work_idx on outlook_tasks (status, updated_at)
  where status in ('pending', 'processing', 'acting');
create unique index outlook_tasks_slack_idx on outlook_tasks (slack_channel, slack_ts)
  where status = 'waiting';

alter table outlook_tasks enable row level security;
grant select, insert, update, delete on outlook_tasks to service_role;
