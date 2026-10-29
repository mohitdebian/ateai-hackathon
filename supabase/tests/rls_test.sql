begin;

create extension if not exists pgtap with schema extensions;

select plan(47);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'a@example.com', 'not-used', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'b@example.com', 'not-used', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'admin@example.com', 'not-used', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into organizations (id, name) values
  ('20000000-0000-0000-0000-000000000001', 'Org A'),
  ('20000000-0000-0000-0000-000000000002', 'Org B');

insert into users (id, org_id, name, email) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Viewer A', 'a@example.com'),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Viewer B', 'b@example.com'),
  ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'Admin A', 'admin@example.com');

insert into memberships (user_id, org_id, role) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'viewer'),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'viewer'),
  ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'admin');

insert into employees (id, org_id, name) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Employee A'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Employee B');

insert into knowledge_docs (org_id, employee_id, title, content) values
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'A', 'A'),
  ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'B', 'B');

insert into employee_connectors (org_id, employee_id, provider, address, credential) values
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'agentmail', 'a@example.com', '{"bot_token": "tok-a"}'::jsonb),
  ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'agentmail', 'b@example.com', '{"bot_token": "tok-b"}'::jsonb);

insert into events (org_id, employee_id, channel, kind) values
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'email', 'message'),
  ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'email', 'message');

insert into org_connectors (org_id, provider, credential) values
  ('20000000-0000-0000-0000-000000000001', 'slack', '{"refresh_token": "test"}'::jsonb);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select results_eq('select count(*) from organizations', array[1::bigint], 'viewer sees only its organization');
select results_eq('select count(*) from users', array[2::bigint], 'viewer sees only its organization users');
select results_eq('select count(*) from memberships', array[2::bigint], 'viewer sees only its organization memberships');
select results_eq('select count(*) from employees', array[1::bigint], 'viewer sees only its organization employees');
select results_eq('select count(*) from knowledge_docs', array[1::bigint], 'viewer sees only its organization knowledge');
select results_eq('select count(*) from employee_connectors', array[1::bigint], 'viewer sees only its organization connectors');
select results_eq('select count(*) from events', array[1::bigint], 'viewer sees only its organization events');

select throws_ok(
  $$insert into employees (org_id, name) values ('20000000-0000-0000-0000-000000000001', 'Blocked')$$,
  '42501', null, 'viewer cannot write employees'
);
select throws_ok(
  $$insert into knowledge_docs (org_id, employee_id, title, content) values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Blocked', 'Blocked')$$,
  '42501', null, 'viewer cannot write knowledge'
);
select throws_ok(
  $$insert into employee_connectors (org_id, employee_id, provider) values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'blocked')$$,
  '42501', null, 'viewer cannot write connectors'
);
select throws_ok(
  $$insert into events (org_id, employee_id, channel, kind) values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'email', 'message')$$,
  '42501', null, 'viewer cannot write events'
);
select results_eq('select count(*) from org_connectors', array[0::bigint], 'viewer cannot read its own org connectors');
select results_eq('select count(*) from webhook_events', array[0::bigint], 'viewer cannot read webhook claims');
select results_eq('select count(*) from rate_limits', array[0::bigint], 'viewer cannot read rate limits');
select ok(not has_function_privilege('authenticated', 'public.check_rate_limit(text, integer, interval)', 'execute'), 'viewer cannot call limiter');
select throws_ok($$select * from employee_connectors$$, '42501', null, 'viewer cannot use wildcard select');
select throws_ok($$select credential from employee_connectors$$, '42501', null, 'viewer cannot read credentials');
select throws_ok($$select credential->>'bot_token' from employee_connectors$$, '42501', null, 'viewer cannot read credential fields');
select throws_ok(
  $$select count(*) from employee_connectors where credential->>'bot_token' = 'test'$$,
  '42501', null, 'viewer cannot filter by credential'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select results_eq('select count(*) from org_connectors', array[0::bigint], 'anon cannot read org connectors');
select results_eq('select count(*) from webhook_events', array[0::bigint], 'anon cannot read webhook claims');
select results_eq('select count(*) from rate_limits', array[0::bigint], 'anon cannot read rate limits');
select ok(not has_function_privilege('anon', 'public.check_rate_limit(text, integer, interval)', 'execute'), 'anon cannot call limiter');
select results_eq('select count(*) from employee_connectors', array[0::bigint], 'anon sees no connector rows');
select throws_ok($$select * from employee_connectors$$, '42501', null, 'anon cannot use wildcard select');
select throws_ok($$select credential from employee_connectors$$, '42501', null, 'anon cannot read credentials');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select results_eq(
  $$select provider from employee_connectors$$,
  array['agentmail'::text], 'admin reads same-org connector metadata'
);
select throws_ok(
  $$insert into employee_connectors (org_id, employee_id, provider, credential) values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'slack', '{"bot_token":"x"}'::jsonb)$$,
  '42501', null, 'admin cannot insert credentials'
);
select throws_ok(
  $$update employee_connectors set credential = '{"bot_token":"x"}'::jsonb where employee_id = '30000000-0000-0000-0000-000000000001' and provider = 'agentmail'$$,
  '42501', null, 'admin cannot update credentials'
);
select throws_ok(
  $$delete from employee_connectors where employee_id = '30000000-0000-0000-0000-000000000001' and provider = 'agentmail' returning *$$,
  '42501', null, 'admin cannot expose credentials via delete returning'
);
select lives_ok(
  $$insert into employee_connectors (org_id, employee_id, provider, status) values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'vapi', 'pending')$$,
  'admin inserts connector metadata'
);
select lives_ok(
  $$update employee_connectors set status = 'active' where org_id = '20000000-0000-0000-0000-000000000001' and employee_id = '30000000-0000-0000-0000-000000000001' and provider = 'vapi'$$,
  'admin updates connector metadata'
);
select lives_ok(
  $$delete from employee_connectors where org_id = '20000000-0000-0000-0000-000000000001' and employee_id = '30000000-0000-0000-0000-000000000001' and provider = 'vapi'$$,
  'admin deletes connector metadata'
);

reset role;
set local role service_role;
select lives_ok(
  $$select check_rate_limit('service-role', 1, interval '1 hour')$$,
  'service role can use the rate limiter'
);
select results_eq(
  $$select credential from employee_connectors where org_id = '20000000-0000-0000-0000-000000000001' and employee_id = '30000000-0000-0000-0000-000000000001' and provider = 'agentmail'$$,
  array['{"bot_token": "tok-a"}'::jsonb], 'service role reads exact credentials'
);
select lives_ok(
  $$insert into employee_connectors (org_id, employee_id, provider, credential, status)
    values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'slack', '{"bot_token": "svc"}'::jsonb, 'pending')
    on conflict (employee_id, provider) do update set credential = excluded.credential$$,
  'service role upserts credentials'
);
select results_eq(
  $$select credential from employee_connectors where org_id = '20000000-0000-0000-0000-000000000001' and employee_id = '30000000-0000-0000-0000-000000000001' and provider = 'slack'$$,
  array['{"bot_token": "svc"}'::jsonb], 'service role upsert preserves credentials'
);

reset role;
select lives_ok($$insert into webhook_events (provider, event_key) values ('slack', 'one')$$, 'first webhook claim succeeds');
select throws_ok(
  $$insert into webhook_events (provider, event_key) values ('slack', 'one')$$,
  '23505', null, 'duplicate webhook claim fails'
);
select ok(check_rate_limit('test', 2, interval '1 hour'), 'first request is allowed');
select ok(check_rate_limit('test', 2, interval '1 hour'), 'second request is allowed');
select ok(not check_rate_limit('test', 2, interval '1 hour'), 'third request is denied');
update rate_limits set window_start = now() - interval '2 hours' where bucket = 'test';
select ok(check_rate_limit('test', 2, interval '1 hour'), 'expired window resets');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select results_eq('select count(*) from manager_phone_numbers', array[0::bigint], 'admin cannot read manager_phone_numbers');
select throws_ok(
  $$insert into manager_phone_numbers (user_id, phone_number) values ('10000000-0000-0000-0000-000000000001', '+1234567890')$$,
  '42501', null, 'admin cannot write manager_phone_numbers'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select results_eq('select count(*) from manager_phone_numbers', array[0::bigint], 'anon cannot read manager_phone_numbers');
select throws_ok(
  $$insert into manager_phone_numbers (user_id, phone_number) values ('10000000-0000-0000-0000-000000000001', '+1234567890')$$,
  '42501', null, 'anon cannot write manager_phone_numbers'
);

select * from finish();
rollback;
