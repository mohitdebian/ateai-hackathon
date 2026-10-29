import assert from "node:assert/strict";
import test from "node:test";
import { deprovision } from "./deprovision";

test("deprovision deletes agentmail inbox from connectors and employee record", async () => {
  const deletedCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  process.env.AGENTMAIL_API_KEY = "mock_key";

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/inboxes/") && init?.method === "DELETE") {
      deletedCalls.push(url.split("/inboxes/")[1]);
      return new Response(null, { status: 200 });
    }
    return originalFetch(input, init);
  };

  const deletedEmployees: string[] = [];
  const mockAdmin = {
    from(table: string) {
      if (table === "employee_connectors") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: [
                    {
                      id: "conn-1",
                      employee_id: "emp-1",
                      provider: "agentmail",
                      address: "pepper-123@agentmail.to",
                    },
                  ],
                  error: null,
                });
              },
            };
          },
        };
      }
      if (table === "employees") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data: {
                        email_address: "pepper-alt@agentmail.to",
                        identity: { email_address: "pepper-123@agentmail.to" },
                      },
                      error: null,
                    });
                  },
                };
              },
            };
          },
          delete() {
            return {
              eq(_col: string, val: string) {
                deletedEmployees.push(val);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as Parameters<typeof deprovision>[0];

  try {
    const res = await deprovision(mockAdmin, { id: "emp-1", org_id: "org-1" });
    assert.deepEqual(res, { ok: true });
    assert.equal(deletedEmployees.length, 1);
    assert.equal(deletedEmployees[0], "emp-1");
    assert.ok(deletedCalls.includes("pepper-123@agentmail.to"));
    assert.ok(deletedCalls.includes("pepper-alt@agentmail.to"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deprovision aborts and keeps employee row if AgentMail fails", async () => {
  const originalFetch = globalThis.fetch;
  process.env.AGENTMAIL_API_KEY = "mock_key";

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/inboxes/") && init?.method === "DELETE") {
      return new Response("Internal Server Error", { status: 500 });
    }
    return originalFetch(input, init);
  };

  const deletedEmployees: string[] = [];
  const mockAdmin = {
    from(table: string) {
      if (table === "employee_connectors") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: [
                    {
                      id: "conn-1",
                      employee_id: "emp-1",
                      provider: "agentmail",
                      address: "pepper-fail@agentmail.to",
                    },
                  ],
                  error: null,
                });
              },
            };
          },
        };
      }
      if (table === "employees") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data: { identity: {} },
                      error: null,
                    });
                  },
                };
              },
            };
          },
          delete() {
            return {
              eq(_col: string, val: string) {
                deletedEmployees.push(val);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as Parameters<typeof deprovision>[0];

  try {
    const res = await deprovision(mockAdmin, { id: "emp-1", org_id: "org-1" });
    assert.equal(res.ok, false);
    assert.match((res as { reason: string }).reason, /agentmail/);
    // Crucial: employee row must NOT be deleted if vendor teardown fails
    assert.equal(deletedEmployees.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
