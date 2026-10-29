import crypto from "node:crypto";
import { agentmailApiKey, agentmailWebhookSecret, hasEnv } from "../env";
import { vendorError } from "../retry";

/**
 * AgentMail, webhook + provisioning side. Each employee gets its own
 * inbox at hire; inbound mail arrives on /api/webhooks/agentmail. Replying is
 * the worker's job (see apps/worker/src/channels/agentmail.ts).
 */

const BASE = "https://api.agentmail.to/v0";

/** Provision an inbox for an employee; returns its address (= inbox id). */
export async function provisionInbox(
  displayName: string,
  username: string,
  clientId: string,
): Promise<string> {
  const res = await fetch(`${BASE}/inboxes`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${agentmailApiKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ username, display_name: displayName, client_id: clientId }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw vendorError("agentmail create inbox", res, body);
  }
  const inbox = (await res.json()) as { inbox_id: string };
  return inbox.inbox_id;
}

/** Delete an employee's inbox at teardown. A 404 means it's already gone. */
export async function deleteInbox(inboxId: string): Promise<void> {
  if (!hasEnv("AGENTMAIL_API_KEY")) return;
  const res = await fetch(`${BASE}/inboxes/${inboxId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${agentmailApiKey()}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(`agentmail delete inbox ${res.status}: ${body}`);
  }
}

/**
 * Verify the webhook signature (AgentMail signs via svix): HMAC-SHA256 over
 * `{svix-id}.{svix-timestamp}.{rawBody}` keyed with the base64 part of the
 * `whsec_…` secret; `svix-signature` holds space-separated `v1,<base64>`
 * candidates. Same hand-rolled style as the Slack verifier — no svix dependency.
 */
export function verifyAgentmailSignature(
  rawBody: string,
  svixId: string | null,
  svixTimestamp: string | null,
  svixSignature: string | null,
): boolean {
  if (!svixId || !svixTimestamp || !svixSignature) return false;
  if (Math.abs(Date.now() / 1000 - Number(svixTimestamp)) > 60 * 5) return false;

  const secret = agentmailWebhookSecret().replace(/^whsec_/, "");
  const expected = crypto
    .createHmac("sha256", Buffer.from(secret, "base64"))
    .update(`${svixId}.${svixTimestamp}.${rawBody}`)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  return svixSignature.split(" ").some((candidate) => {
    const sig = Buffer.from(candidate.split(",")[1] ?? "");
    return sig.length === expectedBuf.length && crypto.timingSafeEqual(sig, expectedBuf);
  });
}

/** The slice of the message.received payload the webhook uses. */
export interface AgentmailInbound {
  inbox_id: string;
  message_id: string;
  from: string;
  subject?: string;
  text?: string;
}
