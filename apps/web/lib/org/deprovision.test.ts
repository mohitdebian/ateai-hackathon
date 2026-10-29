import assert from "node:assert/strict";
import test from "node:test";
import { deprovisionOrganization } from "./deprovision";

test("deprovisionOrganization collects and deletes all AgentMail inboxes before deleting org", async () => {
  const deletedInboxes: string[] = [];
  const originalFetch = globalThis.fetch;
  process.env.AGENTMAIL_API_KEY = "mock_key";

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/inboxes/") && init?.method === "DELETE") {
      deletedInboxes.push(url.split("/inboxes/")[1]);
      return new Response(null, { status: 200 });
    }
    return originalFetch(input, init);
  };

  const deletedOrgIds: string[] = [];
  const deletedAuthUsers: string[] = [];

  const mockAdmin = {
    from(table: string) {
      if (table === "employees") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: [
                    {
                      id: "emp-1",
                      org_id: "org-1",
                      email_address: "tony@agentmail.to",
                      identity: { email_address: "tony@agentmail.to" },
                    },
                    {
                      id: "emp-2",
                      org_id: "org-1",
                      email_address: null,
                      identity: { email_address: "pepper@agentmail.to" },
                    },
                  ],
                  error: null,
                });
              },
            };
          },
        };
      }
      if (table === "employee_connectors") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: [
                    {
                      id: "conn-1",
                      org_id: "org-1",
                      provider: "agentmail",
                      address: "rhodey@agentmail.to",
                    },
                  ],
                  error: null,
                });
              },
            };
          },
        };
      }
      if (table === "users") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: [{ id: "user-1" }],
                  error: null,
                });
              },
            };
          },
        };
      }
      if (table === "organizations") {
        return {
          delete() {
            return {
              eq(_col: string, val: string) {
                deletedOrgIds.push(val);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    auth: {
      admin: {
        deleteUser(userId: string) {
          deletedAuthUsers.push(userId);
          return Promise.resolve({ data: null, error: null });
        },
      },
    },
  } as unknown as Parameters<typeof deprovisionOrganization>[0];

  try {
    const res = await deprovisionOrganization(mockAdmin, "org-1");
    assert.deepEqual(res, { ok: true });
    // Verify all 3 unique AgentMail inboxes were deleted
    assert.ok(deletedInboxes.includes("tony@agentmail.to"));
    assert.ok(deletedInboxes.includes("pepper@agentmail.to"));
    assert.ok(deletedInboxes.includes("rhodey@agentmail.to"));
    assert.equal(deletedInboxes.length, 3);
    // Verify org deletion and auth user cleanup
    assert.deepEqual(deletedOrgIds, ["org-1"]);
    assert.deepEqual(deletedAuthUsers, ["user-1"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deprovisionOrganization aborts if AgentMail deletion fails", async () => {
  const originalFetch = globalThis.fetch;
  process.env.AGENTMAIL_API_KEY = "mock_key";

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/inboxes/") && init?.method === "DELETE") {
      return new Response("Forbidden", { status: 403 });
    }
    return originalFetch(input, init);
  };

  const deletedOrgIds: string[] = [];

  const mockAdmin = {
    from(table: string) {
      if (table === "employees") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: [
                    {
                      id: "emp-1",
                      org_id: "org-1",
                      email_address: "tony@agentmail.to",
                      identity: {},
                    },
                  ],
                  error: null,
                });
              },
            };
          },
        };
      }
      if (table === "employee_connectors") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      }
      if (table === "users") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      }
      if (table === "organizations") {
        return {
          delete() {
            return {
              eq(_col: string, val: string) {
                deletedOrgIds.push(val);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    auth: {
      admin: {
        deleteUser: () => Promise.resolve({ data: null, error: null }),
      },
    },
  } as unknown as Parameters<typeof deprovisionOrganization>[0];

  try {
    const res = await deprovisionOrganization(mockAdmin, "org-1");
    assert.equal(res.ok, false);
    assert.match((res as { reason: string }).reason, /agentmail/);
    // Org must NOT be deleted if remote inbox teardown fails
    assert.equal(deletedOrgIds.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
