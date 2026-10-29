create table manager_phone_numbers (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  phone_number text not null check (phone_number ~ '^\+[1-9]\d{1,14}$'),
  created_at   timestamptz not null default now(),
  unique (user_id, phone_number)
);

alter table manager_phone_numbers enable row level security;
-- No policies => only service_role can read/write.

-- Local/CI Postgres needs explicit service_role grants since the default grant 
-- migration only covers anon and authenticated.
grant select, insert, update, delete on table manager_phone_numbers to service_role;
