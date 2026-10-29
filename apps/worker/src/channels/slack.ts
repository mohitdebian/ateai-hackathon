/**
 * Slack delivery (worker side). The worker owns replying on the originating
 * channel (docs/architecture.md "The flow"), so the reply is posted from here
 * rather than the webhook.
 * One bot per employee: the webhook passes the employee's own bot token in the
 * delivery. There is no global fallback token (#71) — replying as some other
 * workspace's bot is worse than failing.
 */
export async function postSlackMessage(
  channel: string,
  text: string,
  botToken?: string,
  threadTs?: string,
): Promise<string> {
  const token = botToken;
  if (!token) throw new Error("Missing bot token (delivery.slack_bot_token).");

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel, text, ...(threadTs ? { thread_ts: threadTs } : {}) }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json()) as { ok: boolean; error?: string; ts?: string };
  if (!data.ok || !data.ts) throw new Error(`slack chat.postMessage failed: ${data.error ?? "missing timestamp"}`);
  return data.ts;
}

export async function openSlackDm(
  userId: string,
  botToken?: string,
): Promise<string> {
  if (!botToken)
    throw new Error("Missing bot token (needed to open a Slack DM).");

  const res = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      authorization: `Bearer ${botToken}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ users: userId }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    channel?: { id?: string };
  };
  if (!data.ok || !data.channel?.id) {
    throw new Error(
      `slack conversations.open failed: ${data.error ?? "missing channel"}`,
    );
  }
  return data.channel.id;
}
