import crypto from "node:crypto";
import type { SlackOrgCredential } from "@ate/shared";
import { connectorFields } from "@ate/shared";
import { createAdminClient } from "../supabase/server";
import { vendorError } from "../retry";

/**
 * Slack (docs/architecture.md "Slack"). Webhook-side helpers plus per-employee app provisioning: every
 * employee gets its own Slack app, created from a manifest at hire, installed
 * once by an admin via OAuth. The webhook verifies each request with the
 * owning app's signing secret; the worker posts replies with that app's token.
 * Both live on the employee's `slack` connector row (#250).
 */

/**
 * Verify the `v0` request signature (HMAC-SHA256 over `v0:timestamp:body`)
 * against a specific app's signing secret. Rejects requests older than 5
 * minutes (replay protection).
 */
export function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
): boolean {
  if (!signature || !timestamp) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${crypto
    .createHmac("sha256", signingSecret)
    .update(base)
    .digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Strip a leading `<@BOTID>` mention so the model sees just the request text. */
export function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

// --- Per-employee app provisioning -----------------------

/**
 * `users:read` + `users:read.email` back the counterparty lookup (#43): Slack
 * sends only a user id, so the employee resolves the sender's email to tell its
 * manager from an outsider.
 *
 * Manifest scopes apply to newly created apps only — an employee hired before
 * this landed keeps its old grant until the app is reinstalled, and its
 * users.info calls return `missing_scope`. That path degrades to `external`.
 */
/**
 * Asked for at install because a scope added later reaches no existing employee
 * (#278). Deliberately left out: `search:read`, `files:read` and
 * `channels:manage` — reading a whole workspace is the line an enterprise
 * security review stops at, and nothing needs them yet.
 */
export const BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:join",
  "channels:read",
  "chat:write",
  "chat:write.public",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "im:write",
  "mpim:history",
  "mpim:read",
  "reactions:write",
  "team:read",
  "users:read",
  "users:read.email",
];

export interface SlackAppCredentials {
  app_id: string;
  client_id: string;
  client_secret: string;
  signing_secret: string;
}

/** Rotate a little early so a token can't expire mid-request. */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

/**
 * The org's App Configuration Token, used to create its employees' Slack apps
 * and kept fresh automatically (#48).
 *
 * Slack expires config tokens after 12h but pairs each with a refresh token;
 * `tooling.tokens.rotate` returns a new access token AND a new refresh token,
 * invalidating the old one. That rotating chain is why the credential lives in
 * the database rather than an env var, and why it is per org: a pair is per
 * (Slack user, workspace), so two orgs sharing one means the first to rotate
 * breaks the rest.
 *
 * Reads its own service-role client on purpose: `org_connectors` has RLS on
 * with no policies, so no tenant-scoped client can see this credential.
 *
 * Concurrency: the cached access token means hires almost never rotate at all.
 * When two do race, Slack allows a refresh token to be replayed for a grace
 * period (verified: rotating twice with the same token returns ok both times),
 * so both hires get a usable access token and both succeed — the only effect is
 * that one row write overwrites the other. The `invalid_refresh_token` branch
 * below covers the case where that grace window has passed: re-read the row,
 * because whoever won the race has already stored a fresh token. Either way the
 * user never sees an error and no lock is needed.
 */
async function getConfigToken(orgId: string): Promise<string> {
  const admin = createAdminClient();

  const read = async () => {
    const { data } = await admin
      .from("org_connectors")
      .select("credential")
      .eq("org_id", orgId)
      .eq("provider", "slack")
      .maybeSingle();
    return connectorFields<SlackOrgCredential>(data?.credential);
  };

  const fresh = (row: SlackOrgCredential | Partial<SlackOrgCredential>) =>
    row.access_token && row.expires_at
      ? Date.parse(row.expires_at) - Date.now() > EXPIRY_SKEW_MS
      : false;

  const row = await read();
  if (!row.refresh_token) {
    throw new Error(
      "no Slack App Configuration Token for this org — seed org_connectors.credential " +
        "with a refresh token from api.slack.com/apps",
    );
  }
  if (fresh(row)) return row.access_token!;

  const res = await fetch("https://slack.com/api/tooling.tokens.rotate", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: row.refresh_token }),
  });
  const body = (await res.json().catch(() => ({ ok: false, error: "invalid response" }))) as {
    ok: boolean;
    error?: string;
    token?: string;
    refresh_token?: string;
    exp?: number;
  };

  if (!body.ok || !body.token || !body.refresh_token) {
    // Lost a rotation race: whoever won has already stored a usable token.
    if (body.error === "invalid_refresh_token") {
      const latest = await read();
      if (fresh(latest)) return latest.access_token!;
    }
    throw vendorError(
      "slack tooling.tokens.rotate failed",
      res,
      body.error ?? "unknown",
      body.error,
    );
  }

  // Persist BEFORE returning: the rotation already invalidated the old refresh
  // token, so losing the new one here would break the chain irrecoverably.
  const credential: SlackOrgCredential = {
    refresh_token: body.refresh_token,
    access_token: body.token,
    // Slack always sends exp; an absent one lands in the past, which just makes
    // the next call rotate again rather than trust a token of unknown age.
    expires_at: new Date((body.exp ?? 0) * 1000).toISOString(),
  };
  const { error } = await admin
    .from("org_connectors")
    .update({ credential })
    .eq("org_id", orgId)
    .eq("provider", "slack");
  if (error) throw new Error(`slack config token store failed: ${error.message}`);

  return body.token;
}

/**
 * Whether this org can create employee Slack apps at all — the same "vendor not
 * wired for this client" question `hasEnv` answers for the key-based vendors,
 * except the Slack credential is per org rather than an env var. Hire reports a
 * connector with no credential as `skipped`, so a client that has not seeded
 * Slack still hires its employee on the other channels.
 */
export async function orgHasConfigToken(orgId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("org_connectors")
    .select("credential")
    .eq("org_id", orgId)
    .eq("provider", "slack")
    .maybeSingle();
  return Boolean(connectorFields<SlackOrgCredential>(data?.credential).refresh_token);
}

/**
 * Create the employee's Slack app from a manifest, using an App Configuration
 * Token that is rotated automatically (#48) — no manual re-pasting.
 */
export async function createSlackApp(
  orgId: string,
  botName: string,
  appUrl: string,
): Promise<SlackAppCredentials> {
  const configToken = await getConfigToken(orgId);

  const manifest = {
    display_information: { name: botName.slice(0, 35) },
    features: {
      bot_user: { display_name: botName.slice(0, 80), always_online: true },
      // Slack defaults the DM composer to off when app_home is absent (#93).
      // read_only must also be false, or the tab renders with a greyed-out box.
      app_home: {
        messages_tab_enabled: true,
        messages_tab_read_only_enabled: false,
      },
    },
    oauth_config: {
      redirect_urls: [`${appUrl}/api/slack/oauth`],
      scopes: { bot: BOT_SCOPES },
    },
    settings: {
      event_subscriptions: {
        request_url: `${appUrl}/api/webhooks/slack`,
        bot_events: ["app_mention", "message.im"],
      },
    },
  };

  const res = await fetch("https://slack.com/api/apps.manifest.create", {
    method: "POST",
    headers: { authorization: `Bearer ${configToken}`, "content-type": "application/json" },
    body: JSON.stringify({ manifest }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({ ok: false, error: "invalid response" }))) as {
    ok: boolean;
    error?: string;
    app_id?: string;
    credentials?: { client_id: string; client_secret: string; signing_secret: string };
  };
  if (!body.ok || !body.app_id || !body.credentials) {
    throw vendorError(
      "slack apps.manifest.create failed",
      res,
      body.error ?? "unknown",
      body.error,
    );
  }
  return { app_id: body.app_id, ...body.credentials };
}

/**
 * Delete the employee's Slack app at teardown. Slack always answers HTTP 200
 * with a JSON `ok` flag rather than a real HTTP error code; an app that's
 * already gone comes back as an `ok: false` "not found"-shaped error, which is
 * treated as success to match the idempotent teardown of the other vendors.
 */
export async function deleteApp(orgId: string, appId: string): Promise<void> {
  const configToken = await getConfigToken(orgId);

  const res = await fetch("https://slack.com/api/apps.manifest.delete", {
    method: "POST",
    headers: { authorization: `Bearer ${configToken}`, "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json()) as { ok: boolean; error?: string };
  if (body.ok) return;
  if (body.error && /not_found|not_exist/i.test(body.error)) {
    console.error(`slack apps.manifest.delete: ${body.error} (already gone, treating as deleted)`);
    return;
  }
  throw new Error(`slack apps.manifest.delete failed: ${body.error ?? "unknown"}`);
}

/**
 * The one-click "Install to Slack" link shown in the hire panel. `state` is a
 * single-use random nonce stored on the employee's Slack connector
 * (`config.install_state`) — the OAuth callback authenticates by matching it (#33).
 */
export function installUrl(clientId: string, state: string, appUrl: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: BOT_SCOPES.join(","),
    state,
    redirect_uri: `${appUrl}/api/slack/oauth`,
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

/** Exchange the OAuth install code for the app's bot token + bot user id. */
export async function exchangeInstallCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<{ bot_token: string; bot_user_id: string }> {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    bot_user_id?: string;
  };
  if (!body.ok || !body.access_token || !body.bot_user_id) {
    throw new Error(`slack oauth.v2.access failed: ${body.error ?? "unknown"}`);
  }
  return { bot_token: body.access_token, bot_user_id: body.bot_user_id };
}
