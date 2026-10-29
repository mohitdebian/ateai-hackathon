/**
 * The message envelope — the single normalized shape every inbound channel
 * (AgentMail, Slack, Vapi, heartbeat) is reduced to before it reaches the worker.
 * Defined in docs/data-model.md "Envelope": `{org_id, employee_id, channel, text}`.
 */

export type Channel = "email" | "slack" | "voice" | "heartbeat" | "web";

/**
 * Who the employee is talking to this turn (#43). Without it the employee
 * addresses its own manager and a stranger identically.
 *
 * Email and Slack model exactly one internal identity — this employee's
 * manager — because orgs are effectively single-user and the schema has no
 * team concept (docs/product.md "Demo MVP"); anyone else there is external.
 *
 * Voice is different: every call comes in through the authenticated
 * dashboard, so the caller is always internal, just not always the manager —
 * `coworker` covers that case. Widen further when orgs gain a real team
 * concept.
 */
export interface Counterparty {
  kind: "manager" | "coworker" | "external";
  /** Display name, when we resolved one. */
  name?: string;
  /** Email address, or Slack user id — whatever identified them. */
  address?: string;
}

export interface Envelope {
  org_id: string;
  employee_id: string;
  channel: Channel;
  text: string;
  /** Absent on heartbeat turns, and whenever the sender could not be resolved. */
  counterparty?: Counterparty;
}

/**
 * Where the worker should send its reply on the originating channel
 * (docs/data-model.md "Envelope"). Omitted for turns with no one to reply to — e.g. the
 * heartbeat. Per-channel address fields are filled in as adapters land.
 */
export interface Delivery {
  channel: Channel;
  /** Slack channel or DM id to post the reply into. */
  slack_channel?: string;
  /** Slack thread root when the inbound message was a threaded reply. */
  slack_thread_ts?: string;
  /** The employee's own bot token to post with; worker falls back to env. */
  slack_bot_token?: string;
  /** AgentMail inbox the mail arrived in; replies are sent from it. */
  inbox_id?: string;
  /** AgentMail message id the reply threads onto. */
  message_id?: string;
}

/**
 * The worker's POST /turn request body. A webhook that must ack its provider
 * fast includes `delivery` so the worker replies on the channel itself and the
 * webhook can return immediately; a caller that can wait (heartbeat, tests)
 * omits it and reads the reply from the response.
 */
export interface TurnRequest extends Envelope {
  delivery?: Delivery;
}
