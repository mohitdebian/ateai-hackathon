import { test } from "node:test";
import assert from "node:assert/strict";
import type { Counterparty, IdentityFile } from "@ate/shared";
import { buildSystemPrompt, todayLine } from "./prompt.js";
import type { LoadedEmployee, RecentMessage } from "./employee.js";
import type { DocumentSummary } from "./knowledge.js";

const employee: LoadedEmployee = {
  id: "emp-1",
  org_id: "org-1",
  name: "Avery",
  identity: {} as IdentityFile,
};

const manager: Counterparty = { kind: "manager", name: "Priya", address: "priya@acme.test" };
const customer: Counterparty = { kind: "external", name: "Zed", address: "zed@client.test" };

test("labels recent messages with who they were actually with", () => {
  const recent: RecentMessage[] = [
    { direction: "inbound", text: "status?", counterparty: manager },
    { direction: "inbound", text: "hi there", counterparty: customer },
    { direction: "outbound", text: "sure thing", counterparty: customer },
    { direction: "outbound", text: "on it" },
  ];

  const prompt = buildSystemPrompt(employee, [], [], recent, manager, "email");

  // The manager's own exchange reads as today.
  assert.match(prompt, /^Priya: status\?$/m);
  assert.match(prompt, /^You: on it$/m);
  // Another conversation pulled in by recency is never attributed to the manager.
  assert.match(prompt, /^Zed: hi there$/m);
  assert.match(prompt, /^You \(to Zed\): sure thing$/m);
});

test("falls back to the current counterparty for unstamped inbound messages", () => {
  const recent: RecentMessage[] = [{ direction: "inbound", text: "legacy row" }];
  const prompt = buildSystemPrompt(employee, [], [], recent, manager, "email");
  assert.match(prompt, /^Priya: legacy row$/m);
});

test("renders heartbeat rows as the employee's own activity notes", () => {
  const recent: RecentMessage[] = [
    { direction: "outbound", text: "sent the weekly report", channel: "heartbeat" },
    { direction: "inbound", text: "thanks!", counterparty: manager, channel: "slack" },
  ];
  const prompt = buildSystemPrompt(employee, [], [], recent, manager, "email");
  // A heartbeat note is never attributed to the conversation.
  assert.match(prompt, /^You \(activity note\): sent the weekly report$/m);
  assert.match(prompt, /^Priya: thanks!$/m);
});

test("names an uploaded document and tells the model to never deny it", () => {
  const documents: DocumentSummary[] = [
    { title: "Systems_assignment", chunks: 4, created_at: "2026-08-13T21:18:00Z" },
  ];
  const prompt = buildSystemPrompt(employee, [], [], [], manager, "slack", documents);
  assert.match(prompt, /Systems_assignment/);
  assert.match(prompt, /Never say a document is missing/);
  assert.match(prompt, /read_document/);
});

test("an empty document list reads as nothing uploaded, not a load failure", () => {
  const prompt = buildSystemPrompt(employee, [], [], [], manager, "slack", []);
  assert.match(prompt, /No documents have been uploaded/);
});

test("a null document list never reads as 'no documents'", () => {
  const prompt = buildSystemPrompt(employee, [], [], [], manager, "slack", null);
  assert.doesNotMatch(prompt, /No documents have been uploaded/);
  assert.match(prompt, /could not be loaded|can't check/);
});

test("voice-live gets the document list without the read_document instruction", () => {
  const documents: DocumentSummary[] = [
    { title: "Handbook", chunks: 2, created_at: "2026-08-13T21:18:00Z" },
  ];
  const prompt = buildSystemPrompt(employee, [], [], [], manager, "voice-live", documents);
  assert.match(prompt, /Handbook/);
  assert.doesNotMatch(prompt, /read_document/);
});

test("any turn may email anyone (#271)", () => {
  const providers = ["agentmail"];
  const managerPrompt = buildSystemPrompt(employee, [], [], [], manager, "email", null, providers);
  const externalPrompt = buildSystemPrompt(employee, [], [], [], customer, "email", null, providers);
  for (const prompt of [managerPrompt, externalPrompt]) {
    assert.match(prompt, /You may email anyone whose address you have/);
    assert.doesNotMatch(prompt, /Do not message anyone else/);
  }
});

test("heartbeats report only work the manager needs to know", () => {
  const prompt = buildSystemPrompt(employee, [], [], [], undefined, "heartbeat");
  assert.match(prompt, /Do not report routine work/);
  assert.match(prompt, /When unsure, say nothing/);
  assert.match(prompt, /Send one brief message/);
});

test("external questions are escalated only after available sources are checked", () => {
  const prompt = buildSystemPrompt(employee, [], [], [], customer, "email");
  assert.match(prompt, /memory, documents, knowledge, and available tools/);
  assert.match(prompt, /Do not mention asking anyone or escalating/);
  assert.match(prompt, /one specific question/);
});

test("every turn is told what day it is (#280)", () => {
  assert.equal(
    todayLine(new Date("2026-09-15T12:00:00Z")),
    "Today is Tuesday, 15 September 2026. Work out any date the other person gives you from " +
      "this one, and never record a date in the past.",
  );
  // Just after UTC midnight it is still the previous evening in New York.
  assert.match(todayLine(new Date("2026-09-15T03:00:00Z")), /^Today is Monday, 14 September 2026\./);
  assert.match(buildSystemPrompt(employee, [], [], [], manager, "email"), /^Today is \w+, \d+ \w+ \d{4}\./m);
});

test("opening line lists only the channels the employee actually has (#309)", () => {
  const emailOnly = buildSystemPrompt(employee, [], [], [], manager, "email", null, ["agentmail"]);
  assert.match(emailOnly, /You work through email. You reply/);
  assert.doesNotMatch(emailOnly, /You work through email, Slack/);

  const all = buildSystemPrompt(employee, [], [], [], manager, "email", null, ["agentmail", "slack", "vapi"]);
  assert.match(all, /You work through email, Slack and voice./);
});

test("capabilities block forbids empty promises (#309)", () => {
  const prompt = buildSystemPrompt(employee, [], [], [], manager, "email", null, ["agentmail", "vapi"]);
  assert.match(prompt, /Rules for taking action/);
  assert.match(prompt, /If someone asks you to do something through a channel or tool you do not have/);
});

test("shows degraded line when activeProviders is null (#309)", () => {
  const prompt = buildSystemPrompt(employee, [], [], [], manager, "email", null, null);
  assert.match(prompt, /You cannot verify your connected apps right now/);
});

test("injects manager email address into prompt counterparty section", () => {
  const prompt = buildSystemPrompt(employee, [], [], [], manager, "web");
  assert.match(prompt, /Priya \(priya@acme\.test\) — your manager\./);
  assert.match(prompt, /Their email address is priya@acme\.test/);
  assert.match(prompt, /you know your manager is talking to you/);
  assert.match(prompt, /Whenever they say 'email me'/);
});
