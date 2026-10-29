import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import type { Envelope } from "@ate/shared";
import { callWithTruncationRetry, memoryNote, TRUNCATION_NUDGE } from "./turn.js";

const reply = (
  stop_reason: Anthropic.Message["stop_reason"],
  content: Anthropic.Message["content"] = [{ type: "text", text: "done", citations: null }],
): Anthropic.Message =>
  ({
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    stop_reason,
    stop_sequence: null,
    content,
    usage: { input_tokens: 1, output_tokens: 1 },
  }) as Anthropic.Message;

/** Cut off mid-tool-call: leading text survives, which is why an empty-text check misses it. */
const truncated = () =>
  reply("max_tokens", [
    { type: "text", text: "Sure — first I'll set up the columns", citations: null },
  ]);

function scripted(...replies: Anthropic.Message[]) {
  let sent = 0;
  const send = async () => {
    const next = replies[sent++];
    assert.ok(next, `send called ${sent} times, only ${replies.length} scripted`);
    return next;
  };
  return { send, sent: () => sent };
}

const nudges = (messages: Anthropic.Messages.MessageParam[]) =>
  messages.filter((m) => m.role === "user" && m.content === TRUNCATION_NUDGE).length;

test("a reply that fits is returned untouched", async () => {
  const { send, sent } = scripted(reply("end_turn"));
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "hi" }];
  let truncations = 0;

  const message = await callWithTruncationRetry(
    send,
    messages,
    async () => void truncations++,
    () => true,
  );

  assert.equal(message.stop_reason, "end_turn");
  assert.equal(sent(), 1);
  assert.equal(truncations, 0);
  assert.deepEqual(messages, [{ role: "user", content: "hi" }]);
});

test("a cut-off reply is discarded and re-asked with the nudge", async () => {
  const { send, sent } = scripted(truncated(), reply("tool_use"));
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "build a sheet" }];
  let truncations = 0;

  const message = await callWithTruncationRetry(
    send,
    messages,
    async () => void truncations++,
    () => true,
  );

  assert.equal(message.stop_reason, "tool_use");
  assert.equal(sent(), 2);
  assert.equal(truncations, 1);
  assert.equal(nudges(messages), 1);
  assert.ok(
    !messages.some((m) => m.role === "assistant"),
    "the truncated message must never be pushed onto the conversation",
  );
});

test("a spent turn budget stops the retry, since the outer loop only checks between round-trips", async () => {
  const { send, sent } = scripted(truncated());
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "build a sheet" }];
  let truncations = 0;

  const message = await callWithTruncationRetry(
    send,
    messages,
    async () => void truncations++,
    () => false,
  );

  assert.equal(message.stop_reason, "max_tokens");
  assert.equal(sent(), 1);
  assert.equal(truncations, 0);
  assert.equal(nudges(messages), 0);
});

test("retries are capped at two, then the truncated reply is handed back", async () => {
  const { send, sent } = scripted(truncated(), truncated(), truncated());
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "build a sheet" }];
  let truncations = 0;

  const message = await callWithTruncationRetry(
    send,
    messages,
    async () => void truncations++,
    () => true,
  );

  assert.equal(message.stop_reason, "max_tokens");
  assert.equal(sent(), 3);
  assert.equal(truncations, 2);
  assert.equal(nudges(messages), 2);
});

const HEARTBEAT_PROMPT =
  "Heartbeat check-in. Review your recent conversation and memory: if you committed to " +
  "follow up on something that is now due, do it (use your tools if you have them).";

const envelope = (channel: Envelope["channel"], text: string): Envelope => ({
  org_id: "o1",
  employee_id: "e1",
  channel,
  text,
});

test("an idle heartbeat writes nothing to memory", () => {
  assert.equal(
    memoryNote(
      envelope("heartbeat", HEARTBEAT_PROMPT),
      "No open commitments due right now.",
      false,
    ),
    null,
  );
});

test("an acted heartbeat stores the action without its own prompt", () => {
  const note = memoryNote(
    envelope("heartbeat", HEARTBEAT_PROMPT),
    "Sent Acme the renewal quote.",
    true,
  );
  assert.deepEqual(note, [
    { role: "assistant", content: "Heartbeat action: Sent Acme the renewal quote." },
  ]);
  assert.ok(!note?.[0].content.includes("Heartbeat check-in"));
});

test("a real turn is written whether or not it used a tool", () => {
  const expected = [
    { role: "user", content: "when does Acme renew?" },
    { role: "assistant", content: "14 March." },
  ];
  for (const acted of [false, true]) {
    assert.deepEqual(
      memoryNote(envelope("slack", "when does Acme renew?"), "14 March.", acted),
      expected,
    );
  }
});

test("an escalation records who is waiting, where, and the question — not the email (#216)", () => {
  const external: Envelope = {
    ...envelope("email", "Can you confirm whether the contract is approved?"),
    counterparty: { kind: "external", name: "Zed", address: "zed@example.com" },
  };
  const note = memoryNote(external, "I'll check and follow up.", true, "Is the Acme contract approved?");
  assert.deepEqual(note?.[2], {
    role: "assistant",
    content:
      "Open question for the manager: Is the Acme contract approved? " +
      "(asked for Zed, waiting on email)",
  });
});

test("a coworker waiting is recorded too, not just an outsider", () => {
  const coworker: Envelope = {
    ...envelope("slack", "any update on the Acme contract?"),
    counterparty: { kind: "coworker", name: "Dana", address: "dana@example.com" },
  };
  const note = memoryNote(coworker, "Checking now.", true, "Is the Acme contract approved?");
  assert.match(note?.[2]?.content ?? "", /asked for Dana, waiting on slack/);
});

test("nothing is recorded when the employee did not say it was escalating", () => {
  const external: Envelope = {
    ...envelope("email", "Can you confirm whether the contract is approved?"),
    counterparty: { kind: "external", name: "Zed", address: "zed@example.com" },
  };
  assert.equal(memoryNote(external, "Yes, it is approved.", true)?.length, 2);
});
