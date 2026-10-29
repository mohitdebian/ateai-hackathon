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
