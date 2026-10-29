import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ComposioCredential,
  Database,
  EmployeeConnectorRow,
  IdentityFile,
  SlackConfig,
  SlackCredential,
  VapiPhoneConfig,
} from "@ate/shared";
import { connectorFields, connectorSpec } from "@ate/shared";
import { deleteInbox, provisionInbox } from "../channels/agentmail";
import { createSlackApp, deleteApp, installUrl, orgHasConfigToken } from "../channels/slack";
import { createVapiAssistant, deleteAssistant, releasePhoneNumber } from "../channels/vapi";
import { deleteConnectedAccount } from "../composio";
import { defaultEmailUsername, slugify } from "../employees/handles";
import { hasEnv } from "../env";
import { isAgentmailRetryable, isRateLimited, isTimeoutError, withRetry } from "../retry";

/**
 * The connector handlers (#250). The registry in `@ate/shared` says what
 * each connector is; this says how to set one up and tear it down. Adding a
 * connector is a registry entry plus an entry here — the tables do not change.
 *
 * Each handler owns its own `employee_connectors` row, so the hire route is a
 * loop over what the org has turned on rather than four calls in sequence.
 */

export interface StepResult {
  /** The channel the connector serves, or its provider when it serves none. */
  step: string;
  status: "ok" | "skipped" | "failed" | "action";
  detail: string;
  url?: string;
}

export interface ProvisionContext {
  db: SupabaseClient<Database>;
  employee: { id: string; org_id: string; name: string };
  /** Mutated by a handler that settles a requested handle (email, Slack). */
  identity: IdentityFile;
  appUrl: string;
  /** This employee's existing row, when hire is being retried. */
  existing: EmployeeConnectorRow | null;
}

export interface ConnectorHandler {
  /** Set the connector up for one employee and record it. Omitted when there is
   * nothing to do at hire — a Composio toolkit is granted from the access panel. */
  provision?(ctx: ProvisionContext): Promise<StepResult>;
  /** Release the vendor resource. Omitted when there is nothing to release. */
  deprovision?(row: EmployeeConnectorRow): Promise<void>;
}

const agentmail: ConnectorHandler = {
  async provision({ db, employee, identity, existing }) {
    if (existing?.address) return { step: "email", status: "ok", detail: existing.address };
    if (!hasEnv("AGENTMAIL_API_KEY")) {
      return { step: "email", status: "skipped", detail: "AGENTMAIL_API_KEY not configured" };
    }

    // The configure step's email field is the requested username. Guarded, not
    // just slugified: slugify falls back to "employee" on empty input, which
    // would make every org request the same inbox name.
    const fallback = defaultEmailUsername(employee.name, employee.id);
    const requested = identity.email_address ? slugify(identity.email_address.split("@")[0]) : "";
    const claim = (username: string) =>
      withRetry(() => provisionInbox(employee.name, username, employee.id), {
        attempts: 4,
        isRetryable: isAgentmailRetryable,
      });

    try {
      let address: string;
      if (requested) {
        try {
          address = await claim(requested);
        } catch (err) {
          if (isTimeoutError(err)) throw err;
          if (isAgentmailRetryable(err)) throw err;
          address = await claim(fallback);
        }
      } else {
        address = await claim(fallback);
      }
      identity.email_address = address;
      await upsert(db, employee, "agentmail", { address });
      return { step: "email", status: "ok", detail: address };
    } catch (err) {
      return { step: "email", status: "failed", detail: message(err) };
    }
  },
  async deprovision(row) {
    if (row.address) await deleteInbox(row.address);
  },
};

const slack: ConnectorHandler = {
  async provision({ db, employee, identity, appUrl, existing }) {
    const credential = connectorFields<SlackCredential>(existing?.credential);
    const config = connectorFields<SlackConfig>(existing?.config);
    if (credential.bot_token) return { step: "slack", status: "ok", detail: "installed" };

    // A fresh single-use nonce per install link (#33) — the OAuth callback
    // authenticates by matching it, so the state param is never guessable.
    const nonce = crypto.randomUUID();

    if (existing?.address && config.client_id) {
      await upsert(db, employee, "slack", {
        config: { ...config, install_state: nonce },
        status: "pending",
      });
      return {
        step: "slack",
        status: "action",
        detail: "app created — click to install it to your workspace",
        url: installUrl(config.client_id, nonce, appUrl),
      };
    }

    if (!(await orgHasConfigToken(employee.org_id))) {
      return {
        step: "slack",
        status: "skipped",
        detail: "no Slack App Configuration Token for this org",
      };
    }

    try {
      const handle = identity.slack_handle?.replace(/^@/, "").trim() || slugify(employee.name);
      const app = await withRetry(() => createSlackApp(employee.org_id, handle, appUrl), {
        attempts: 4,
        isRetryable: isRateLimited,
      });
      await upsert(db, employee, "slack", {
        address: app.app_id,
        credential: { client_secret: app.client_secret, signing_secret: app.signing_secret },
        config: { client_id: app.client_id, install_state: nonce },
        status: "pending",
      });
      identity.slack_handle = `@${handle}`;
      return {
        step: "slack",
        status: "action",
        detail: `app "${handle}" created — click to install it to your workspace`,
        url: installUrl(app.client_id, nonce, appUrl),
      };
    } catch (err) {
      return { step: "slack", status: "failed", detail: message(err) };
    }
  },
  async deprovision(row) {
    if (row.address) await deleteApp(row.org_id, row.address);
  },
};

const vapi: ConnectorHandler = {
  async provision({ db, employee, identity, appUrl, existing }) {
    if (existing?.address) return { step: "voice", status: "ok", detail: "assistant ready" };
    if (!hasEnv("VAPI_API_KEY")) {
      return { step: "voice", status: "skipped", detail: "VAPI_API_KEY not configured" };
    }
    try {
      const address = await withRetry(
        () => createVapiAssistant(employee.name, identity, `${appUrl}/api/webhooks/vapi`),
        { attempts: 4, isRetryable: isRateLimited },
      );
      await upsert(db, employee, "vapi", { address });
      return { step: "voice", status: "ok", detail: "assistant ready" };
    } catch (err) {
      return { step: "voice", status: "failed", detail: message(err) };
    }
  },
  async deprovision(row) {
    if (row.address) await deleteAssistant(row.address);
  },
};

/**
 * A phone number is bought per employee from the profile, not at hire (#252):
 * numbers cost money every month and most employees need none. So there is no
 * `provision` here and the hire loop skips it — the same shape a Composio
 * toolkit has. `POST /api/employees/[id]/phone` is the provisioning side.
 */
const vapiPhone: ConnectorHandler = {
  async deprovision(row) {
    const { phone_number_id } = connectorFields<VapiPhoneConfig>(row.config);
    if (phone_number_id) await releasePhoneNumber(phone_number_id);
  },
};

/**
 * Composio toolkits are granted from the access panel, not at hire, so this
 * handler only tears one down. Matched by reach rather than by provider: there
 * are ~1000 toolkit slugs and they share one implementation.
 */
const composioToolkit: ConnectorHandler = {
  async deprovision(row) {
    const { composio_account_id } = connectorFields<ComposioCredential>(row.credential);
    if (composio_account_id) await deleteConnectedAccount(composio_account_id);
  },
};

const NATIVE: Record<string, ConnectorHandler> = { agentmail, slack, vapi, vapi_phone: vapiPhone };

export function handlerFor(provider: string): ConnectorHandler | null {
  if (NATIVE[provider]) return NATIVE[provider];
  return connectorSpec(provider).reach === "composio" ? composioToolkit : null;
}

async function upsert(
  db: SupabaseClient<Database>,
  employee: { id: string; org_id: string },
  provider: string,
  row: Partial<Pick<EmployeeConnectorRow, "address" | "credential" | "config" | "status">>,
): Promise<void> {
  const { error } = await db
    .from("employee_connectors")
    .upsert(
      { org_id: employee.org_id, employee_id: employee.id, provider, ...row },
      { onConflict: "employee_id,provider" },
    );
  if (error) throw new Error(`could not record the ${provider} connector: ${error.message}`);
}

function message(err: unknown): string {
  if (isTimeoutError(err)) return "Timed out; completion could not be confirmed";
  return err instanceof Error ? err.message : String(err);
}
