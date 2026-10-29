-- Slack App Configuration Token, with automatic rotation (#48).
--
-- Creating an employee's Slack app calls apps.manifest.create, which needs an
-- App Configuration Token. Slack expires those after 12h, so the previous
-- hand-pasted SLACK_CONFIG_TOKEN env var broke every hire past that window.
-- Slack pairs each config token with a refresh token; tooling.tokens.rotate
-- mints a fresh access token and a NEW refresh token (the chain rotates), so
-- the refresh token must live somewhere writable — an env var cannot work.
--
-- SINGLETON, deliberately not org-scoped: this is ate.ai's own credential for
-- ate.ai's Slack workspace, not tenant data. Every employee app for every
-- customer is created in our workspace and (once public distribution is on,
-- #31) installed into theirs — customers never have their own config token.
-- `id boolean primary key default true check (id)` makes "at most one row" a
-- database guarantee.
--
-- Secrets in table columns is the same MVP tradeoff as 0003 (service-role
-- writes only); moving Slack secrets to a secrets store is #30.

create table slack_config_token (
  id            boolean primary key default true check (id),
  refresh_token text not null,
  access_token  text,
  expires_at    timestamptz,
  updated_at    timestamptz not null default now()
);

-- No policies: RLS on with zero policies denies every non-service-role query,
-- so this platform credential is unreachable from tenant-scoped requests.
alter table slack_config_token enable row level security;
