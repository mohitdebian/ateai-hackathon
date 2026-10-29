/**
 * AgentMail delivery channel. The worker sends from the employee's own inbox.
 * Configured via AGENTMAIL_API_KEY (same key the web app provisions inboxes with).
 */

const BASE = "https://api.agentmail.to/v0";

export async function sendEmail(
  inboxId: string,
  to: string,
  subject: string,
  text: string,
): Promise<{ message_id: string; thread_id: string }> {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) throw new Error("Missing AGENTMAIL_API_KEY (needed to send email).");

  const res = await fetch(`${BASE}/inboxes/${encodeURIComponent(inboxId)}/messages/send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ to, subject, text }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`agentmail send ${res.status}: ${body}`);
  }
  return (await res.json()) as { message_id: string; thread_id: string };
}

export async function replyToEmail(
  inboxId: string,
  messageId: string,
  text: string,
): Promise<void> {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) throw new Error("Missing AGENTMAIL_API_KEY (needed to send email replies).");

  const res = await fetch(
    `${BASE}/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/reply`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`agentmail reply ${res.status}: ${body}`);
  }
}
