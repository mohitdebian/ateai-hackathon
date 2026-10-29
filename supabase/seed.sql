-- Demo seed (spec F1: "seed script with one demo org"). Runs as the postgres
-- role, so it bypasses RLS. Auth users are NOT seeded here (they come from
-- Supabase Auth signup); after you sign up, attach yourself to the demo org so
-- the dashboard shows this data:
--
--   insert into memberships (user_id, org_id, role)
--   values ('<your-auth-uid>', '00000000-0000-0000-0000-000000000001', 'admin');
--
-- Fixed UUIDs make the seed idempotent and easy to reference.

insert into organizations (id, name, plan) values
  ('00000000-0000-0000-0000-000000000001', 'Acme Inc (demo)', 'free')
on conflict (id) do nothing;

-- Two AI employees for the dashboard demo.
insert into employees (id, org_id, name, hired_at, manager_id, identity, created_at) values
  ('00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-000000000001',
   'Ava Chen', now() - interval '3 days', null,
   jsonb_build_object(
     'name', 'Ava Chen',
     'avatar', 'A calm, precise operations lead.',
     'role', 'Operations Lead',
     'persona', 'Operations lead who keeps the team unblocked.',
     'scope_of_work', 'Own inbound support triage and daily standup summaries.',
     'daily_responsibilities', jsonb_build_array('Triage the shared inbox', 'Post a standup summary', 'Weekly metrics digest'),
     'manager', jsonb_build_object('id', ''),
     'operating_rules', jsonb_build_array('Never share customer PII externally'),
     'email_address', 'ava@demo.ate.ai',
     'slack_handle', '@ava'
   ),
   now() - interval '3 days')
on conflict (id) do nothing;

insert into employees (id, org_id, name, hired_at, manager_id, identity, created_at) values
  ('00000000-0000-0000-0000-0000000000a2',
   '00000000-0000-0000-0000-000000000001',
   'Rex Support', now() - interval '2 days', null,
   jsonb_build_object(
     'name', 'Rex Support',
     'avatar', 'An eager frontline support rep.',
     'role', 'Support Representative',
     'persona', 'Frontline support agent, fast and friendly.',
     'scope_of_work', 'Answer tier-1 support questions over email and Slack.',
     'daily_responsibilities', jsonb_build_array('Answer support email', 'Respond to Slack mentions'),
     'manager', jsonb_build_object('id', ''),
     'operating_rules', jsonb_build_array('Escalate refunds to Ava'),
     'email_address', 'rex@demo.ate.ai',
     'slack_handle', '@rex'
   ),
   now() - interval '2 days')
on conflict (id) do nothing;

-- What the demo org has turned on, and each employee's inbox (#250). Org
-- creation seeds these for real orgs; the demo org is seeded here.
insert into org_connectors (org_id, provider) values
  ('00000000-0000-0000-0000-000000000001', 'agentmail'),
  ('00000000-0000-0000-0000-000000000001', 'slack'),
  ('00000000-0000-0000-0000-000000000001', 'vapi')
on conflict (org_id, provider) do nothing;

insert into employee_connectors (org_id, employee_id, provider, address) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'agentmail', 'ava@demo.ate.ai'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'agentmail', 'rex@demo.ate.ai')
on conflict (employee_id, provider) do nothing;

-- A few activity-rail events.
insert into events (org_id, employee_id, channel, kind, payload, created_at) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'slack', 'message',
   jsonb_build_object('direction', 'inbound', 'text', 'Where is my order #1024?'), now() - interval '2 hours'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'slack', 'message',
   jsonb_build_object('direction', 'outbound', 'text', 'Order #1024 shipped today; tracking is on the way.'), now() - interval '2 hours' + interval '30 seconds'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'email', 'message',
   jsonb_build_object('direction', 'outbound', 'text', 'Posted the daily standup summary.'), now() - interval '1 hour');
