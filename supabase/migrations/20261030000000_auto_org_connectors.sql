-- Automatically seed default active connectors whenever any organization is created.
-- Covers agentmail, vapi, vapi_phone, and composio:all so phone numbers and channels
-- are available without manual developer intervention.

create or replace function public.handle_new_organization_connectors()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.org_connectors (org_id, provider, status)
  values
    (new.id, 'agentmail', 'active'),
    (new.id, 'vapi', 'active'),
    (new.id, 'vapi_phone', 'active'),
    (new.id, 'composio:all', 'active')
  on conflict (org_id, provider) do update set status = 'active';
  return new;
end;
$$;

drop trigger if exists on_organization_created_connectors on public.organizations;
create trigger on_organization_created_connectors
  after insert on public.organizations
  for each row
  execute function public.handle_new_organization_connectors();

-- Backfill existing organizations with vapi_phone and default active connectors.
insert into public.org_connectors (org_id, provider, status)
select o.id, p.provider, 'active'
from public.organizations o, (values ('agentmail'), ('vapi'), ('vapi_phone'), ('composio:all')) as p(provider)
on conflict (org_id, provider) do update set status = 'active';
