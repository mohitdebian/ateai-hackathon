insert into org_connectors (org_id, provider)
select distinct org_id, 'composio:all'
from org_connectors
where provider not in ('agentmail', 'slack', 'vapi', 'vapi_phone')
  and status = 'active'
on conflict (org_id, provider) do nothing;
