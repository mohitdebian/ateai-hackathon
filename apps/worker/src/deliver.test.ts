import { test } from "node:test";
import assert from "node:assert/strict";
import type { Delivery } from "@ate/shared";
import { deliver } from "./deliver.js";

process.env.AGENTMAIL_API_KEY = "am-test";

/** Records what each connector sent, without leaving the process. */
function captureFetch() {
  const calls: { url: string; token?: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      token: headers.get("authorization") ?? undefined,
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response(JSON.stringify({ ok: true, ts: "1.1" }), { status: 200 });
  }) as typeof fetch;
  return calls;
}

test("a Slack reply is posted with that employee's own bot token", async () => {
  const calls = captureFetch();
  const delivery: Delivery = {
    channel: "slack",
    slack_channel: "C1",
    slack_bot_token: "xoxb-1",
  };
  await deliver(delivery, "hello");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /chat\.postMessage/);
  assert.equal(calls[0].token, "Bearer xoxb-1");
  assert.deepEqual(calls[0].body, { channel: "C1", text: "hello" });
});

test("a threaded Slack reply stays in the manager's email thread", async () => {
  const calls = captureFetch();
  await deliver({ channel: "slack", slack_channel: "D1", slack_thread_ts: "10.20",
    slack_bot_token: "xoxb-1" }, "I will do that");
  assert.deepEqual(calls[0].body, { channel: "D1", text: "I will do that", thread_ts: "10.20" });
});

test("an email reply threads onto the message it answers", async () => {
  const calls = captureFetch();
  await deliver({ channel: "email", inbox_id: "a@b.co", message_id: "m1" }, "hello");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /inboxes\/a%40b\.co\/messages\/m1\/reply$/);
});

test("channels with no one to reply to send nothing", async () => {
  const calls = captureFetch();
  // Voice replies happen live inside the call; heartbeat has no counterparty.
  await deliver({ channel: "voice" }, "hello");
  await deliver({ channel: "heartbeat" }, "hello");
  // A delivery missing the address its connector needs is not an error either.
  await deliver({ channel: "slack" }, "hello");
  await deliver({ channel: "email", inbox_id: "a@b.co" }, "hello");
  await deliver({ channel: "slack", slack_channel: "C1", slack_bot_token: "x" }, "");
  assert.deepEqual(calls, []);
});
