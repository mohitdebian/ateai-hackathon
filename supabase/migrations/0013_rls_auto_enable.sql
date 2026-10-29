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
