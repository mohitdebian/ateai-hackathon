-- Per-employee Slack apps (docs/architecture.md "Slack").
-- Each employee gets its own Slack app, created via the manifest API at hire.
-- The app's credentials live on the employee row: the webhook verifies
-- signatures with slack_signing_secret (looked up by api_app_id), the OAuth
-- install callback stores slack_bot_token, and the worker posts replies with it.
-- (Tokens in table columns is the MVP tradeoff — service-role writes only;
-- moving them to a secrets store is Tier 2 hardening, issue #30.)

alter table employees
  add column slack_app_id        text,
  add column slack_client_id     text,
  add column slack_client_secret text,
  add column slack_signing_secret text,
  add column slack_bot_token     text;

create index employees_slack_app_id_idx on employees (slack_app_id)
  where slack_app_id is not null;
