import { NextResponse, after } from "next/server";
import type { Envelope } from "@ate/shared";
import { dispatchTurn } from "../../../../lib/worker";
import { resolveByAddress } from "../../../../lib/connectors/lookup";
import { resolveByEmail } from "../../../../lib/counterparty";
import {
  verifyAgentmailSignature,
  type AgentmailInbound,
} from "../../../../lib/channels/agentmail";
import { claimWebhookEvent } from "../../../../lib/webhooks/idempotency";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";

/**
 * AgentMail inbound-mail webhook. Same shape as the Slack webhook:
 * verify, ack fast, dispatch the turn in the background with a `delivery` so
 * the worker replies on the thread itself. One inbox per employee — the inbox
 * address is the routing key.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const ok = verifyAgentmailSignature(
    rawBody,
    request.headers.get("svix-id"),
    request.headers.get("svix-timestamp"),
    request.headers.get("svix-signature"),
  );
  if (!ok) return new NextResponse("invalid signature", { status: 401 });

  let payload: { event_type?: string; message?: AgentmailInbound };
  try {
    payload = JSON.parse(rawBody) as { event_type?: string; message?: AgentmailInbound };
  } catch {
    return new NextResponse("invalid JSON", { status: 400 });
  }
  if (payload.event_type !== "message.received" || !payload.message) {
    return new NextResponse("", { status: 200 });
  }

  const mail = payload.message;
  // One inbox per employee: the inbox id is the connector's address (#250).
  const employee = await resolveByAddress("agentmail", mail.inbox_id);
  if (!(await claimWebhookEvent("agentmail", mail.message_id))) {
    return new NextResponse("", { status: 200 });
  }
  if (employee) {
    const counterparty = await resolveByEmail(employee.employee_id, mail.from ?? "");
    const envelope: Envelope = {
      org_id: employee.org_id,
      employee_id: employee.employee_id,
      channel: "email",
      text: [
        ...(mail.subject ? [`Subject: ${mail.subject}`] : []),
        "",
        mail.text ?? "",
      ].join("\n"),
      counterparty,
    };
    after(async () => {
      try {
        await dispatchTurn(envelope, {
          channel: "email",
          inbox_id: mail.inbox_id,
          message_id: mail.message_id,
        });
      } catch (err) {
        console.error("[agentmail] turn dispatch failed", err);
        Sentry.captureException(err);
      }
    });
  }

  return new NextResponse("", { status: 200 });
}
