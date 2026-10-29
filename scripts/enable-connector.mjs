import { URLSearchParams } from "node:url";

/**
 * Turn a connector on or off for one client.
 *
 * Usage: node scripts/enable-connector.mjs <org name or id> <provider> [--disable]
 *        node scripts/enable-connector.mjs <org name or id> slack --refresh-token <token>
 *        node scripts/enable-connector.mjs --list
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment —
 * org_connectors is unreachable with any other key.
 *
 * Plain fetch against PostgREST rather than supabase-js: this runs from the
 * repo root, where a workspace dependency does not resolve.
 */

// Mirrors DEFAULT_ORG_PROVIDERS plus the opt-in ones in packages/shared, which
// cannot be imported from here. A typo like `composio` would otherwise insert a
// row nothing reads and report success. Per-app Composio rows are never written
// by this script, so they are not listed.
const PROVIDERS = ["agentmail", "vapi", "composio:all", "slack", "vapi_phone"];

const [, , ...args] = process.argv;
let connectorArgs;

if (args[0] === "--list") {
  if (args.length !== 1) {
    console.error("usage: enable-connector.mjs --list");
    process.exit(2);
  }
} else {
  const positionals = [];
  let disable = false;
  let refreshToken;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--disable") {
      disable = true;
    } else if (arg === "--refresh-token") {
      refreshToken = args[++i];
      if (!refreshToken || refreshToken.startsWith("--")) {
        console.error("--refresh-token requires a value");
        process.exit(2);
      }
    } else if (arg.startsWith("--")) {
      console.error(`unknown option: ${arg}`);
      process.exit(2);
    } else {
      positionals.push(arg);
    }
  }

  const [org, provider] = positionals;
  if (!org || !provider || positionals.length !== 2) {
    console.error(
      "usage: enable-connector.mjs <org name or id> <provider> [--disable]",
    );
    process.exit(2);
  }
  if (!PROVIDERS.includes(provider)) {
    console.error(`unknown provider "${provider}" — use one of: ${PROVIDERS.join(", ")}`);
    process.exit(2);
  }
  if (refreshToken && provider !== "slack") {
    console.error("--refresh-token is only valid for slack");
    process.exit(2);
  }
  if (disable && refreshToken) {
    console.error("--disable cannot be combined with Slack credentials");
    process.exit(2);
  }

  connectorArgs = { org, provider, disable, refreshToken };
}

const url = (
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  ""
).replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first");
  process.exit(2);
}

async function rest(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

if (args[0] === "--list") {
  const rows = await rest(
    "org_connectors?select=provider,status,organizations(name)&order=provider",
  );
  for (const row of rows) {
    console.log(
      `${row.organizations?.name ?? "?"}\t${row.provider}\t${row.status}`,
    );
  }
  process.exit(0);
}

const { org, provider, disable, refreshToken } = connectorArgs;

// Name or id: an id is what a script gets from a URL, a name is what a person
// has to hand.
const column = /^[0-9a-f-]{36}$/i.test(org) ? "id" : "name";
const orgs = await rest(
  `organizations?select=id,name&${column}=eq.${encodeURIComponent(org)}`,
);
if (!orgs.length) {
  console.error(`no org matching "${org}"`);
  process.exit(1);
}
if (orgs.length > 1) {
  console.error(`"${org}" matches ${orgs.length} orgs — pass an id instead`);
  process.exit(1);
}

const path = `org_connectors?org_id=eq.${encodeURIComponent(orgs[0].id)}&provider=eq.${encodeURIComponent(provider)}`;
if (disable) {
  const rows = await rest(`${path}&select=credential`);
  if (rows[0]?.credential) {
    console.error(
      `warning: ${provider} for ${orgs[0].name} had a credential — re-seed it to restore`,
    );
  }
  await rest(path, { method: "DELETE" });
  console.log(`${provider} is off for ${orgs[0].name}`);
  process.exit(0);
}

let credential;
if (refreshToken) {
  const res = await fetch("https://slack.com/api/tooling.tokens.rotate", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refreshToken }),
  });
  const body = await res
    .json()
    .catch(() => ({ ok: false, error: "invalid response" }));
  if (!res.ok || !body.ok || !body.token || !body.refresh_token) {
    console.error(
      `slack tooling.tokens.rotate failed: ${body.error ?? "unknown"}`,
    );
    process.exit(1);
  }
  credential = {
    refresh_token: body.refresh_token,
    access_token: body.token,
    expires_at: new Date((body.exp ?? 0) * 1000).toISOString(),
  };
}

try {
  await rest("org_connectors?on_conflict=org_id,provider", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      org_id: orgs[0].id,
      provider,
      status: "active",
      ...(credential && { credential }),
    }),
  });
} catch (err) {
  if (credential) {
    console.error(
      "Slack token was rotated but could not be saved; generate a fresh pair at api.slack.com/apps",
    );
  }
  throw err;
}

console.log(`${provider} is on for ${orgs[0].name}`);
