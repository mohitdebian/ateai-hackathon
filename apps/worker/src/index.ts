/**
 * ate.ai worker (Cloud Run). One endpoint runs an employee turn.
 *
 *   GET  /          health check (proves the process + shared contracts resolve)
 *   POST /heartbeat  ack 202, then run a follow-up turn for every hired
 *                    employee in the background (Cloud Scheduler calls this)
 *   POST /turn    body = TurnRequest (Envelope + optional `delivery`)
 *                 - with `delivery`:   ack 202, then run the turn and reply on
 *                   the channel in the background (so a webhook can return fast)
 *                 - without `delivery`: run synchronously, return { reply }
 *                   (heartbeat, tests)
 *   POST /context  body = {org_id, employee_id, counterparty?}; returns the
 *                  assembled system prompt injected into a Vapi call (#119)
 *
 * Background delivery keeps running after the 202 response. On Cloud Run this
 * needs CPU-always-allocated (or min-instances >= 1) so the container isn't
 * throttled between requests — see apps/worker/Dockerfile.
 */
import { createServer, type IncomingMessage } from "node:http";
import * as Sentry from "@sentry/node";
import type { Channel, TurnRequest } from "@ate/shared";
import { isNimConfigured, PORT, serviceName, sharedSecret, supabaseConfig } from "./env.js";
import { runTurn } from "./turn.js";
import { deliver, FAILURE_REPLY } from "./deliver.js";
import { runHeartbeat } from "./heartbeat.js";
import { logDegraded, logNotice } from "./supabase.js";
import { composeNotice, noticeAfter, NOTICE_AFTER_MS } from "./notice.js";
import { buildCallContext, isContextRequest } from "./context.js";
import { runEmailTasks, startEmailRecovery } from "./email/index.js";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    sampleRate: 1,
    tracesSampleRate: 0,
  });
}

const CHANNELS: readonly Channel[] = ["email", "slack", "voice", "heartbeat", "web"];

function isTurnRequest(body: unknown): body is TurnRequest {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.org_id === "string" &&
    typeof b.employee_id === "string" &&
    typeof b.text === "string" &&
    typeof b.channel === "string" &&
    CHANNELS.includes(b.channel as Channel)
  );
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET" && req.url === "/") {
    // K_SERVICE is injected by Cloud Run, so this names the service that
    // actually answered (ate-worker-prod / ate-worker-dev) — the quickest
    // way to confirm which environment a URL reaches.
    return send(200, { ok: true, service: serviceName() });
  }

  const secret = sharedSecret();
  const unauthorized = secret && req.headers["x-worker-secret"] !== secret;

  if (req.method === "POST" && req.url === "/heartbeat") {
    if (unauthorized) return send(401, { error: "missing or invalid x-worker-secret" });
    // Ack before the sweep: with many employees this outlives any scheduler
    // timeout. Needs CPU-always-allocated, same as background delivery.
    send(202, { accepted: true });
    runHeartbeat()
      .then((result) => console.log("[heartbeat] sweep done", result))
      .catch((err) => {
        console.error("[heartbeat] sweep failed", err);
        Sentry.captureException(err);
      });
    runEmailTasks().catch((err: unknown) => {
      console.error("[email] recovery sweep failed", err);
      Sentry.captureException(err);
    });
    return;
  }

  if (req.method === "POST" && req.url === "/email-tasks") {
    if (unauthorized) return send(401, { error: "missing or invalid x-worker-secret" });
    send(202, { accepted: true });
    runEmailTasks().catch((err: unknown) => {
      console.error("[email] task sweep failed", err);
      Sentry.captureException(err);
    });
    return;
  }

  if (req.method === "POST" && req.url === "/turn") {
    if (unauthorized) return send(401, { error: "missing or invalid x-worker-secret" });
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return send(400, { error: "invalid JSON body" });
    }
    if (!isTurnRequest(body)) {
      return send(400, { error: "body must be a TurnRequest {org_id, employee_id, channel, text, delivery?}" });
    }
    const { delivery, ...envelope } = body;

    // Delivery present → ack now, run the turn and reply in the background.
    // The 202 is already sent, so a throw here can only be handled here (#118).
    if (delivery) {
      send(202, { accepted: true });
      const canNotify = delivery.channel === "slack" || delivery.channel === "email";
      const stopNotice = canNotify
        ? noticeAfter(NOTICE_AFTER_MS, async () => {
            const text = await composeNotice(envelope);
            await deliver(delivery, text);
            await logNotice(envelope, text);
          })
        : () => Promise.resolve();
      runTurn(envelope)
        .then(async (reply) => {
          await stopNotice();
          try {
            await deliver(delivery, reply);
          } catch (err) {
            if (err instanceof Error && err.name === "TimeoutError") {
              await logDegraded(envelope, "delivery", err, "Delivery could not be confirmed.");
              return;
            }
            throw err;
          }
        })
        .catch(async (err: unknown) => {
          await stopNotice();
          if (err instanceof Error && err.message.includes("is paused")) {
            console.warn(`[turn] skipped delivery for paused employee: ${err.message}`);
            return;
          }
          // Apologise first so the logged event reflects what the sender
          // actually saw, not what we assume the delivery layer did.
          const notified = await deliver(delivery, FAILURE_REPLY).then(
            () => true,
            (notifyErr: unknown) => {
              console.error("[turn] failure notice undeliverable", notifyErr);
              Sentry.captureException(notifyErr);
              return false;
            },
          );
          await logDegraded(envelope, "delivery", err, notified ? FAILURE_REPLY : undefined);
        });
      return;
    }

    // No delivery → caller waits for the reply.
    try {
      const reply = await runTurn(envelope);
      return send(200, { reply });
    } catch (err) {
      console.error("[turn] failed", err);
      return send(500, { error: err instanceof Error ? err.message : "turn failed" });
    }
  }

  if (req.method === "POST" && req.url === "/context") {
    if (unauthorized) return send(401, { error: "missing or invalid x-worker-secret" });
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return send(400, { error: "invalid JSON body" });
    }
    if (!isContextRequest(body)) {
      return send(400, { error: "body must be {org_id, employee_id, counterparty?}" });
    }
    try {
      return send(200, { system: await buildCallContext(body) });
    } catch (err) {
      console.error("[context] failed", err);
      return send(500, { error: err instanceof Error ? err.message : "context failed" });
    }
  }

  return send(404, { error: "not found" });
});

server.listen(PORT, () => {
  if (supabaseConfig()) {
    const recovery = startEmailRecovery();
    server.once("close", () => clearInterval(recovery));
  }
  console.log(`${serviceName()} listening on :${PORT}`);
  const aiProvider = isNimConfigured()
    ? "configured (NVIDIA NIM)"
    : process.env.ANTHROPIC_API_KEY
      ? "configured (Anthropic)"
      : "MISSING (turns will fail)";
  console.log(`  ai:        ${aiProvider}`);
  console.log(
    `  supabase:  ${supabaseConfig() ? "configured (events -> DB)" : "MISSING (turns will fail)"}`,
  );
});
