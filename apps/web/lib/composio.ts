import { Composio } from "@composio/core";
import { composioApiKey } from "./env";

let client: Composio | null = null;

/**
 * Composio client for the grant-access flow: initiating OAuth links and
 * checking connection status. The Composio "user" is always an EMPLOYEE id, so
 * grants are scoped per employee (docs/architecture.md, the scoping
 * implementation note). Tool execution lives in the
 * worker, not here.
 */
export function composio(): Composio {
  if (!client) client = new Composio({ apiKey: composioApiKey() });
  return client;
}

/**
 * Delete a connected account at teardown. Best-effort: an already-gone
 * account (however the SDK happens to shape that error) is swallowed after
 * being logged; anything else is logged and rethrown so the caller's
 * best-effort loop can record the failure too.
 */
export async function deleteConnectedAccount(connectedAccountId: string): Promise<void> {
  try {
    await composio().connectedAccounts.delete(connectedAccountId, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    const e = err as { status?: number; statusCode?: number; code?: string; message?: string };
    console.error(`composio delete connected account ${connectedAccountId} failed`, err);
    const notFound =
      e?.status === 404 ||
      e?.statusCode === 404 ||
      e?.code === "CONNECTED_ACCOUNT_NOT_FOUND" ||
      /not found/i.test(e?.message ?? "");
    if (!notFound) throw err;
  }
}

export async function revokeToolkit(
  employeeId: string,
  toolkit: string,
  storedAccountId: string | null,
): Promise<void> {
  const { items } = await composio().connectedAccounts.list({
    userIds: [employeeId],
    toolkitSlugs: [toolkit],
  }, { signal: AbortSignal.timeout(30_000) });
  const ids = new Set(items.map((item) => item.id));
  if (storedAccountId) ids.add(storedAccountId);
  for (const id of ids) {
    await deleteConnectedAccount(id);
  }
}
