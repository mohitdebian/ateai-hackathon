import { test } from "node:test";
import assert from "node:assert/strict";
import type { IdentityFile } from "@ate/shared";
import { knowledgeQuery } from "./context.js";
import { buildSystemPrompt } from "./prompt.js";

const identity: IdentityFile = {
  name: "June",
  avatar: "",
  role: "Sales ops coordinator",
  persona: "direct and warm",
  scope_of_work: "keep the CRM tidy",
  daily_responsibilities: ["log deals", "chase renewals"],
  manager: { id: "u1" },
  operating_rules: ["never quote prices"],
  email_address: "june@example.com",
  slack_handle: "june",
};

const employee = { id: "e1", org_id: "o1", name: "June", identity };

test("knowledge query is the identity's job description", () => {
  assert.equal(
    knowledgeQuery(identity),
    "Sales ops coordinator\nkeep the CRM tidy\nlog deals\nchase renewals",
  );
  assert.equal(knowledgeQuery({ ...identity, role: "", daily_responsibilities: [] }), "keep the CRM tidy");
});

test("voice-live prompt speaks and refuses mid-call actions", () => {
  const system = buildSystemPrompt(
    employee,
    ["prefers Tuesday check-ins"],
    [],
    [],
    { kind: "manager", name: "Veer" },
    "voice-live",
  );
  assert.match(system, /live voice call/);
  assert.match(system, /cannot take actions/);
  assert.match(system, /right after the call/);
  assert.match(system, /Veer — your manager/);
  assert.match(system, /prefers Tuesday check-ins/);
});
