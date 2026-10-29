import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  const table = url.pathname.split("/").pop();
  const select = url.searchParams.get("select") ?? "";

  if (table === "employees" && select === "manager_id") {
    return Response.json({ manager_id: "manager-user" });
  }
  if (table === "users") {
    return Response.json({ name: "Priya Manager", email: "priya@example.com" });
  }
  if (url.hostname === "slack.com") {
    return Response.json({
      ok: true,
      user: { real_name: "Priya", profile: { email: "priya@example.com" } },
    });
  }
  return Response.json(null, { status: 404 });
};

test("the manager writing from their own address is recognised (#149)", async () => {
  const { resolveByEmail } = await import("./counterparty");
  assert.deepEqual(await resolveByEmail("employee-1", "Priya <PRIYA@Example.com>"), {
    kind: "manager",
    name: "Priya",
    address: "priya@example.com",
  });
});

test("anyone else emailing is external", async () => {
  const { resolveByEmail } = await import("./counterparty");
  assert.deepEqual(await resolveByEmail("employee-1", "Sam Buyer <sam@acme.com>"), {
    kind: "external",
    name: "Sam Buyer",
    address: "sam@acme.com",
  });
});

test("a bare address with no display name still resolves", async () => {
  const { resolveByEmail } = await import("./counterparty");
  assert.deepEqual(await resolveByEmail("employee-1", "sam@acme.com"), {
    kind: "external",
    address: "sam@acme.com",
  });
});

test("resolves a manager from Slack's verified user record", async () => {
  const { resolveBySlackUser } = await import("./counterparty");
  assert.deepEqual(await resolveBySlackUser("employee-1", "U123", "xoxb-test"), {
    kind: "manager",
    name: "Priya",
    address: "priya@example.com",
  });
});
