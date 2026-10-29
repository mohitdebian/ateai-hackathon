-- Local/CI Postgres never gets the anon/authenticated/service_role table
-- grants a hosted Supabase project receives automatically at creation (same
-- drift class as 0013's hand-made trigger): every table here is owner-only
-- until granted, so `authenticated` gets "permission denied" even though RLS
-- policies exist. RLS restricts which rows a role sees; these grants are what
-- let the role touch the table at all. Without this, 0018's rls_test.sql
-- cannot run against a freshly migrated database (only the original, by-hand
-- hosted project happens to have these already).
--
-- Table/sequence grants only — functions are deliberately excluded. 0018
-- already revokes public.check_rate_limit from everyone but service_role and
-- the RLS suite asserts authenticated/anon can't call it; a blanket function
-- grant here would silently re-open that.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to anon, authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
