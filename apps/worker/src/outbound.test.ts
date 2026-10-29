import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import type { Database } from "@ate/shared";
import { asSlackChannel, loadOutboundContext, sendManagerSlack, sendMessage } from "./outbound.js";
import { localToolRuntime } from "./tools.js";

process.env.AGENTMAIL_API_KEY = "agentmail-key";

let slackLookupUnavailable = true;
let slackDmUnavailable = false;
let slackPostUnavailable = false;
let agentmailUnavailable = false;
const requests: Request[] = [];

const fetchMock: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);

  if (url.hostname === "supabase.test") {
    if (url.pathname.endsWith("/employees")) {
      return Response.json({
        manager_id: "manager-1",
      });
    }
    if (url.pathname.endsWith("/employee_connectors")) {
      return Response.json([
        { provider: "agentmail", address: "employee@agentmail.to", credential: {}, status: "active" },
        {
          provider: "slack",
          address: "A123",
          credential: { bot_token: "xoxb-test" },
          status: "active",
        },
      ].filter((row) => !agentmailUnavailable || row.provider !== "agentmail"));
    }
    if (url.pathname.endsWith("/users")) {
      return Response.json({ email: "Manager@Example.com" });
    }
  }

  requests.push(request);
  if (url.hostname === "api.agentmail.to") {
    return Response.json({ message_id: "message-1", thread_id: "thread-1" });
  }
  if (url.pathname.endsWith("/users.lookupByEmail")) {
    if (slackLookupUnavailable) return Response.json({ ok: false, error: "users_not_found" });
    return Response.json({ ok: true, user: { id: "U123" } });
  }
  if (url.pathname.endsWith("/conversations.open")) {
    if (slackDmUnavailable) return Response.json({ ok: false, error: "missing_scope" });
    return Response.json({ ok: true, channel: { id: "D123" } });
  }
  if (url.pathname.endsWith("/chat.postMessage")) {
    if (slackPostUnavailable) return Response.json({ ok: false, error: "not_in_channel" });
    return Response.json({ ok: true, ts: "1.1" });
  }
  return Response.json({}, { status: 404 });
};

globalThis.fetch = fetchMock;

const admin = createClient<Database>("https://supabase.test", "service-role", {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: fetchMock },
});

const execute = async (input: Record<string, unknown>) =>
  (await localToolRuntime(admin, "org-1", "employee-1")).execute({
    content: [{ type: "tool_use", id: "tool-1", name: "send_message", input }],
  } as Anthropic.Message);

test("event-driven manager DM uses Slack without requiring AgentMail or falling back", async () => {
  agentmailUnavailable = true;
  slackLookupUnavailable = false;
  try {
    assert.deepEqual(await sendManagerSlack(admin, "org-1", "employee-1", "New mail"),
      { channel: "D123", ts: "1.1" });
    slackPostUnavailable = true;
    await assert.rejects(sendManagerSlack(admin, "org-1", "employee-1", "New mail"), /not_in_channel/);
  } finally {
    agentmailUnavailable = false;
    slackPostUnavailable = false;
    slackLookupUnavailable = true;
  }
});

test("sends to the manager and falls back from an unknown Slack identity to email", async () => {
  const context = await loadOutboundContext(admin, "org-1", "employee-1");
  assert.equal(
    await sendMessage(context, {
      channel: "slack",
      to: "manager@example.com",
      text: "Here are the notes.",
    }),
    "email",
  );

  const email = requests.find((request) => request.url.includes("api.agentmail.to"));
  assert.ok(email);
  assert.deepEqual(await email.json(), {
    to: "manager@example.com",
    subject: "Message from your employee",
    text: "Here are the notes.",
  });

  slackLookupUnavailable = false;
  const execution = await execute({
    channel: "slack",
    text: "The report is ready.",
  });
  assert.equal(execution.outcomes[0]?.successful, true);
  assert.ok(requests.some((request) => request.url.endsWith("/conversations.open")));
  assert.ok(requests.some((request) => request.url.endsWith("/chat.postMessage")));
  slackLookupUnavailable = true;
});

test("falls back to email when Slack cannot open a DM", async () => {
  slackDmUnavailable = true;
  slackLookupUnavailable = false;
  const start = requests.length;
  const context = await loadOutboundContext(admin, "org-1", "employee-1");

  assert.equal(
    await sendMessage(context, {
      channel: "slack",
      to: "manager@example.com",
      text: "The report is ready.",
    }),
    "email",
  );

  const sent = requests.slice(start);
  assert.ok(sent.some((request) => request.url.includes("api.agentmail.to")));
  assert.ok(!sent.some((request) => request.url.endsWith("/chat.postMessage")));
  slackDmUnavailable = false;
  slackLookupUnavailable = true;
});

test("an email can be sent to a third party", async () => {
  const start = requests.length;
  const execution = await execute({
    channel: "email",
    to: "acme@example.com",
    subject: "Invoice",
    text: "The invoice is attached.",
  });
  assert.equal(execution.outcomes[0]?.successful, true);

  const email = requests.slice(start).find((request) => request.url.includes("api.agentmail.to"));
  assert.ok(email);
  assert.deepEqual(await email.json(), {
    to: "acme@example.com",
    subject: "Invoice",
    text: "The invoice is attached.",
  });
});

test("a third party can be emailed on a turn nobody started (#271)", async () => {
  const start = requests.length;
  const execution = await execute({
    channel: "email",
    to: "customer@example.com",
    subject: "Your booking",
    text: "Confirming the dates we agreed.",
  });
  assert.equal(execution.outcomes[0]?.successful, true);

  const email = requests.slice(start).find((request) => request.url.includes("api.agentmail.to"));
  assert.ok(email);
  assert.equal(((await email.json()) as { to: string }).to, "customer@example.com");
});

test("the employee titles its own message to the manager", async () => {
  const start = requests.length;
  const execution = await execute({
    channel: "email",
    subject: "Huracan is double booked",
    text: "Two customers want it on Friday.",
  });
  assert.equal(execution.outcomes[0]?.successful, true);

  const email = requests.slice(start).find((request) => request.url.includes("api.agentmail.to"));
  assert.ok(email);
  // Defaulted from the stored address, delivered in its stored case (#217).
  const sent = (await email.json()) as { to: string; subject: string };
  assert.equal(sent.to, "Manager@Example.com");
  assert.equal(sent.subject, "Huracan is double booked");
});

test("a recipient is delivered exactly as written", async () => {
  const start = requests.length;
  const execution = await execute({
    channel: "email",
    to: "  Bob.Smith@Acme.com  ",
    subject: "Invoice",
    text: "The invoice is attached.",
  });
  assert.equal(execution.outcomes[0]?.successful, true);

  const email = requests.slice(start).find((request) => request.url.includes("api.agentmail.to"));
  assert.ok(email);
  assert.equal(((await email.json()) as { to: string }).to, "Bob.Smith@Acme.com");
});

test("the manager is matched whatever case the model writes", async () => {
  const start = requests.length;
  const execution = await execute({
    channel: "email",
    to: "MANAGER@Example.com",
    text: "The report is ready.",
  });
  assert.equal(execution.outcomes[0]?.successful, true);
  const email = requests.slice(start).find((request) => request.url.includes("api.agentmail.to"));
  assert.ok(email);
  const sent = (await email.json()) as { to: string; subject: string };
  assert.equal(sent.to, "MANAGER@Example.com");
  assert.equal(sent.subject, "Message from your employee");
});

test("a channel is told from a person (#275)", () => {
  assert.equal(asSlackChannel("#dispatch"), "#dispatch");
  assert.equal(asSlackChannel("C01234567"), "C01234567");
  assert.equal(asSlackChannel("manager@example.com"), null);
  assert.equal(asSlackChannel("Manager@Example.com"), null);
});

test("posts to a Slack channel rather than DMing anyone (#275)", async () => {
  const start = requests.length;
  const execution = await execute({
    channel: "slack",
    to: "#dispatch",
    text: "Drop the 911 Carrera 4S at 3811 Turtle Creek Blvd, Friday 4pm.",
  });
  assert.equal(execution.outcomes[0]?.successful, true);

  const sent = requests.slice(start);
  const post = sent.find((request) => request.url.endsWith("/chat.postMessage"));
  assert.ok(post);
  assert.equal(((await post.json()) as { channel: string }).channel, "#dispatch");
  // A channel is a place, not a person: no DM opened, and no subject needed.
  assert.ok(!sent.some((request) => request.url.endsWith("/conversations.open")));
  assert.ok(!sent.some((request) => request.url.includes("api.agentmail.to")));
});

test("a failed channel post does not fall back to email (#275)", async () => {
  slackPostUnavailable = true;
  const start = requests.length;
  const execution = await execute({ channel: "slack", to: "#dispatch", text: "Car is out." });
  assert.equal(execution.outcomes[0]?.successful, false);
  assert.ok(!requests.slice(start).some((request) => request.url.includes("api.agentmail.to")));
  slackPostUnavailable = false;
});
