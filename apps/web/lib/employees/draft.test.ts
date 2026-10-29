import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeDraft, type DraftSettings } from "./draft";

test("normalizes stringified and newline-delimited draft lists", () => {
  const raw: unknown = {
    daily_responsibilities: JSON.stringify(["Triage inbound leads", "Book qualified calls"]),
    operating_rules: "Verify availability before confirming\nEscalate legal questions",
  };

  assert.deepEqual(sanitizeDraft(raw as Partial<DraftSettings>), {
    name: "",
    role: "",
    persona: "",
    scope_of_work: "",
    daily_responsibilities: ["Triage inbound leads", "Book qualified calls"],
    operating_rules: ["Verify availability before confirming", "Escalate legal questions"],
  });
});

test("leaves anything that isn't a plain list of strings as readable text", () => {
  const wrapped = sanitizeDraft({
    daily_responsibilities: ['["Triage inbound leads","Book qualified calls"]'] as string[],
  });
  assert.deepEqual(wrapped.daily_responsibilities, ["Triage inbound leads", "Book qualified calls"]);

  const objects = sanitizeDraft({ daily_responsibilities: '[{"task":"Triage"}]' as unknown as string[] });
  assert.deepEqual(objects.daily_responsibilities, ['[{"task":"Triage"}]']);
});
