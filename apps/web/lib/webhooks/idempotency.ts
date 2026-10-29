import { createAdminClient } from "../supabase/server";

type WebhookProvider = "slack" | "agentmail" | "vapi";

/**
 * Claim a provider delivery. false means another request already claimed it.
 * ponytail: a crash after claiming drops its redelivery; add a durable outbox if needed.
 */
export async function claimWebhookEvent(provider: WebhookProvider, key: string): Promise<boolean> {
  const { error } = await createAdminClient().from("webhook_events").insert({
    provider,
    event_key: key,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`webhook claim failed: ${error.message}`);
}
