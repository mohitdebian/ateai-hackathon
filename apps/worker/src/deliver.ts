import type { Delivery } from "@ate/shared";
import { providerForChannel } from "@ate/shared";
import { postSlackMessage } from "./channels/slack.js";
import { replyToEmail } from "./channels/agentmail.js";

/** What the sender gets when a turn fails (#118) — says nothing about what broke (#116). */
export const FAILURE_REPLY =
  "Sorry - I hit a problem on that one and couldn't finish it. Please try again in a moment.";

/**
 * Reply through the connector the message came in on (#250). Adding one is an
 * entry in the shared registry plus an entry here.
 *
 * A connector with no entry sends nothing: voice replies happen live inside the
 * Vapi call, and heartbeat has no one to reply to. Both are still logged as
 * events by runTurn.
 */
const DELIVERERS: Record<string, (delivery: Delivery, reply: string) => Promise<void>> = {
  slack: async (delivery, reply) => {
    if (delivery.slack_channel)
      await postSlackMessage(delivery.slack_channel, reply, delivery.slack_bot_token, delivery.slack_thread_ts);
  },
  agentmail: async (delivery, reply) => {
    if (delivery.inbox_id && delivery.message_id)
      await replyToEmail(delivery.inbox_id, delivery.message_id, reply);
  },
};

/** Send a reply on the channel it came in on. */
export async function deliver(delivery: Delivery, reply: string): Promise<void> {
  if (!reply) return;
  const provider = providerForChannel(delivery.channel);
  await DELIVERERS[provider ?? ""]?.(delivery, reply);
}
