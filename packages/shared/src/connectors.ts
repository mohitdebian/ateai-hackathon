/**
 * The connector registry: one entry per way an employee reaches the outside
 * world, plus the shapes of the JSON columns behind it.
 *
 * The rows live in `org_connectors` (what a client has turned on) and
 * `employee_connectors` (what one employee has), described in
 * docs/data-model.md. Adding a connector is an entry here plus a handler —
 * `apps/web/lib/connectors` to provision it, `apps/worker/src/deliver.ts` to
 * reply on it — and no migration.
 */
import type { Channel } from "./envelope.js";

/** Whether the connector carries messages in, out, or both. */
export type ConnectorDirection = "in" | "out" | "both";

/**
 * `per-employee` — each employee owns its own address here.
 * `shared` — the org has one, offered to every employee, with no employee rows.
 */
export type ConnectorIdentity = "per-employee" | "shared";

/** Where the credential that actually reaches the vendor is stored. */
export type CredentialSource = "platform" | "org" | "employee";

/** How a turn reaches it: our own code, a Composio toolkit, or a plain HTTP call. */
export type ConnectorReach = "native" | "composio" | "http";

/**
 * `pending` is provisioned-but-not-usable — a Slack app nobody has installed
 * yet. Only `active` rows are routed to or attached to a turn.
 */
export type ConnectorStatus = "active" | "pending" | "expired";

export interface ConnectorSpec {
  direction: ConnectorDirection;
  identity: ConnectorIdentity;
  credential: CredentialSource;
  reach: ConnectorReach;
  /** The envelope channel its turns run on. Absent when it only carries tools. */
  channel?: Channel;
  /** How it is set up. This registry is also the connector documentation. */
  setup: string;
}

export const CONNECTORS: Record<string, ConnectorSpec> = {
  agentmail: {
    direction: "both",
    identity: "per-employee",
    credential: "platform",
    reach: "native",
    channel: "email",
    setup:
      "One inbox per employee at hire (AGENTMAIL_API_KEY). `address` is the inbox id, " +
      "which is also the email address. Inbound arrives on one account-wide webhook per " +
      "environment; the address is the only routing key.",
  },
  slack: {
    direction: "both",
    identity: "per-employee",
    credential: "employee",
    reach: "native",
    channel: "slack",
    setup:
      "One Slack app per employee, created at hire from a manifest with the org's App " +
      "Configuration Token (`org_connectors.credential`, #48) and installed by an admin " +
      "over OAuth. `address` is the app id — what every inbound event carries.",
  },
  vapi: {
    direction: "both",
    identity: "per-employee",
    credential: "platform",
    reach: "native",
    channel: "voice",
    setup:
      "One assistant per employee at hire (VAPI_API_KEY). `address` is the assistant id, " +
      "which the end-of-call webhook reports.",
  },
  vapi_phone: {
    direction: "in",
    identity: "per-employee",
    credential: "platform",
    reach: "native",
    // No channel, though calls to it are voice: `providerForChannel` returns the
    // first match, and a number carries no turns of its own — the turn still
    // comes from the `vapi` assistant's end-of-call report.
    setup:
      "A Vapi-provisioned number, bought per employee from the profile rather than at " +
      "hire (#252) — numbers cost money monthly and most employees need none. `address` " +
      "is the number in E.164; `config.phone_number_id` releases it. Created with no " +
      "assistantId on purpose, so every inbound call asks us who answers.",
  },
};

/**
 * Every other provider is a Composio toolkit: the provider IS the toolkit slug,
 * granted per employee from the access panel, and reached only as tools. There
 * are ~1000 of them, so they are a rule rather than a thousand entries.
 */
const COMPOSIO_TOOLKIT: ConnectorSpec = {
  direction: "out",
  identity: "per-employee",
  credential: "employee",
  reach: "composio",
  setup: "Composio managed OAuth from the employee's Grant access panel.",
};

/**
 * The native connectors, in declaration order — which is the order hire
 * provisions the ones it provisions, and the order the wizard's copy promises:
 * email, then Slack, then voice. `vapi_phone` is in the list but has no
 * hire-time handler, so hire skips it (#252): a number is bought per employee
 * from the profile. A new org starts with all of them (#243 makes that a
 * per-client choice).
 */
export const NATIVE_PROVIDERS: string[] = Object.keys(CONNECTORS);

/** Reserved so it cannot collide with a Composio toolkit slug. */
export const COMPOSIO_PROVIDER = "composio:all";

/** New orgs get email, voice, phone numbers, and Composio; Slack opts in. */
export const DEFAULT_ORG_PROVIDERS: string[] = [
  ...NATIVE_PROVIDERS.filter((provider) => provider !== "slack"),
  COMPOSIO_PROVIDER,
];

export function connectorSpec(provider: string): ConnectorSpec {
  return CONNECTORS[provider] ?? COMPOSIO_TOOLKIT;
}

/** The connector a reply on this channel goes back out through. */
export function providerForChannel(channel: Channel): string | null {
  const found = Object.entries(CONNECTORS).find(([, spec]) => spec.channel === channel);
  return found ? found[0] : null;
}

// --- Column shapes ---------------------------------------------------------
//
// Both JSON columns are flat string maps (see ConnectorCredential /
// ConnectorConfig in database.ts), so a write is checked by TypeScript at the
// call site and a read goes through `connectorFields` below.

/** `employee_connectors.credential` for `slack` — the employee's own app secrets. */
export type SlackCredential = {
  client_secret: string;
  signing_secret: string;
  bot_token: string;
};

/** `employee_connectors.config` for `slack`. The app id is the row's `address`. */
export type SlackConfig = {
  client_id: string;
  /** Bot user id, written at install — only the "Open in Slack" DM link uses it. */
  bot_id: string;
  /** Single-use OAuth install nonce (#33); cleared once exchanged. */
  install_state: string;
};

/**
 * `org_connectors.credential` for `slack` — the App Configuration Token that
 * creates employee apps. It rotates on every use, so it cannot be an env var
 * (#48) and cannot be shared between orgs: rotating one invalidates the rest.
 */
export type SlackOrgCredential = {
  refresh_token: string;
  access_token: string;
  expires_at: string;
};

/**
 * `employee_connectors.config` for `vapi_phone`. The number itself is the row's
 * `address`; this is the handle the release call needs.
 */
export type VapiPhoneConfig = {
  phone_number_id: string;
};

/** `employee_connectors.credential` for a Composio toolkit. */
export type ComposioCredential = {
  composio_account_id: string;
};

/**
 * Read a `credential` / `config` column. Postgres hands back whatever was
 * written, so non-string values are dropped rather than trusted — a number
 * where a bot token belongs must never reach an Authorization header.
 */
export function connectorFields<T extends Record<string, string>>(value: unknown): Partial<T> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const fields: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") fields[key] = item;
  }
  return fields as Partial<T>;
}
