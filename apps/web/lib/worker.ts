import type { Counterparty, Envelope, Delivery } from "@ate/shared";
import { workerUrl, workerSharedSecret } from "./env";

function workerEndpoint(path: string): URL {
  const base = workerUrl();
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return new URL(normalizedPath, normalizedBase);
}

/**
 * Hand an inbound turn to the worker and return once the worker has *accepted*
 * it (a fast 202). The worker runs the turn and replies on the channel itself
 * (via `delivery`), so the webhook never holds a connection open for the length
 * of an agent turn — avoiding provider retries and serverless timeouts.
 */
export async function dispatchTurn(envelope: Envelope, delivery: Delivery): Promise<void> {
  const secret = workerSharedSecret();
  const res = await fetch(workerEndpoint("turn"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-worker-secret": secret } : {}),
    },
    body: JSON.stringify({ ...envelope, delivery }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`worker /turn ${res.status}: ${body}`);
  }
}

/**
 * Run a synchronous turn on the web channel (direct dashboard chat).
 * Waits for the employee to execute tools and return its final reply.
 */
export async function runWebTurn(
  orgId: string,
  employeeId: string,
  text: string,
  counterparty: Counterparty,
): Promise<{ reply: string }> {
  const secret = workerSharedSecret();
  const endpoint = workerEndpoint("turn");
  let res: Response | null = null;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(secret ? { "x-worker-secret": secret } : {}),
        },
        body: JSON.stringify({
          org_id: orgId,
          employee_id: employeeId,
          channel: "web",
          text,
          counterparty,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        // Worker might be momentarily restarting; wait and retry
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  if (!res) {
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`worker service unreachable (${endpoint}): ${msg}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`worker /turn ${res.status}: ${body}`);
  }
  return (await res.json()) as { reply: string };
}

/** Wake durable Email work; the worker's recovery sweep covers lost requests. */
export async function dispatchEmailTasks(): Promise<void> {
  const secret = workerSharedSecret();
  const res = await fetch(workerEndpoint("email-tasks"), {
    method: "POST",
    headers: secret ? { "x-worker-secret": secret } : {},
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`worker /email-tasks ${res.status}`);
}

/** The system prompt to inject into a voice call, assembled by the worker (#119). */
export async function fetchVoiceContext(
  orgId: string,
  employeeId: string,
  counterparty: Counterparty,
): Promise<string> {
  const secret = workerSharedSecret();
  const endpoint = workerEndpoint("context");
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { "x-worker-secret": secret } : {}),
      },
      body: JSON.stringify({ org_id: orgId, employee_id: employeeId, counterparty }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`worker /context ${res.status}: ${body}`);
    }
    const { system } = (await res.json()) as { system: string };
    return system;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`worker service unreachable (${endpoint}): ${msg}`);
  }
}

/** Trigger scheduled heartbeat sweep on the worker. */
export async function dispatchHeartbeat(): Promise<void> {
  const secret = workerSharedSecret();
  const res = await fetch(workerEndpoint("heartbeat"), {
    method: "POST",
    headers: secret ? { "x-worker-secret": secret } : {},
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`worker /heartbeat ${res.status}`);
}

