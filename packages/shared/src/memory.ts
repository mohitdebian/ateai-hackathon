import type { Memory, MemoryClient } from "./interfaces.js";
import { stubMemoryClient } from "./interfaces.js";

/**
 * Mem0-backed recall, scoped by employee_id-as-agent.
 * Searched before a turn, written after. Plain REST (no SDK) so the
 * worker stays a single bundle. Falls back to the stub without a key.
 */
const MEM0_BASE = "https://api.mem0.ai/v3/memories";

export function createMemoryClient(apiKey: string | undefined): MemoryClient {
  if (!apiKey) return stubMemoryClient;

  const headers = {
    authorization: `Token ${apiKey}`,
    "content-type": "application/json",
  };

  return {
    async search(orgId, employeeId, query) {
      const res = await fetch(`${MEM0_BASE}/search/`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query,
          filters: { agent_id: employeeId },
          top_k: 5,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`mem0 search ${res.status}: ${await res.text().catch(() => "")}`);
      const json = (await res.json()) as { results?: { memory?: string }[] };
      return (json.results ?? [])
        .map((r) => r.memory)
        .filter((m): m is string => typeof m === "string" && m.length > 0);
    },

    async write(orgId, employeeId, messages) {
      const res = await fetch(`${MEM0_BASE}/add/`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          user_id: orgId,
          agent_id: employeeId,
          messages,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`mem0 add ${res.status}: ${await res.text().catch(() => "")}`);
    },

    async list(orgId, employeeId, limit) {
      const res = await fetch(`${MEM0_BASE}/?page=1&page_size=${limit}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          filters: { agent_id: employeeId },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`mem0 list ${res.status}: ${await res.text().catch(() => "")}`);
      const json = (await res.json()) as { results?: Memory[] };
      return json.results ?? [];
    },
  };
}
