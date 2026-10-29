-- 0004: single-use nonce for the Slack install OAuth state param (#33).
-- The hire route writes a fresh random nonce here when it hands out an
-- install link; the OAuth callback authenticates by matching it (on an
-- employee with no bot token yet) and clears it after the exchange.
alter table employees add column slack_install_state text;
