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
