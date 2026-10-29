import { NextResponse, after } from "next/server";
import crypto from "node:crypto";
import type { Envelope } from "@ate/shared";
import { dispatchTurn, fetchVoiceContext } from "../../../../lib/worker";
import { connectorFor, resolveByAddress } from "../../../../lib/connectors/lookup";
import { createAdminClient } from "../../../../lib/supabase/server";
import { voiceOverrides } from "../../../../lib/channels/vapi";
import { withDeadline } from "../../../../lib/retry";
import { claimWebhookEvent } from "../../../../lib/webhooks/idempotency";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";

/**
 * Vapi call-events webhook. Both the assistant and (since #252) each phone
 * number are created with this URL plus an `x-webhook-secret` header
 * (lib/channels/vapi.ts), so both event types arrive here.
 *
 * `assistant-request` answers an inbound phone call: which employee owns the
 * number that was dialled, and the prompt it should answer with. On
 * `end-of-call-report` we run a normal turn over the transcript — the ONLY turn
 * a call produces, whichever way it came in — so the call lands in the event log
 * and in Mem0, and the employee "remembers" voice conversations exactly like
 * email and Slack ones (docs/architecture.md "Voice").
 */

interface VapiServerMessage {
  message?: {
    type?: string;
    call?: {
      id?: string;
      assistantId?: string;
      /**
       * Echoed back by Vapi — how the transcript turn learns who called (#43).
       * Set server-side at call creation (lib/channels/vapi.ts createVapiWebCall),
       * never by the browser, so `caller_kind` is trustworthy here.
       */
      assistantOverrides?: {
        variableValues?: { caller_name?: string; caller_kind?: string; caller_address?: string };
      };
    };
    assistant?: { id?: string };
    artifact?: { transcript?: string };
    analysis?: { summary?: string };
    /** The number that was dialled, and who dialled it (assistant-request). */
    phoneNumber?: { number?: string };
    customer?: { number?: string };
  };
}

/**
 * Vapi drops an inbound call if nobody says who should answer within 7.5
 * seconds, network included. `/context` assembles recall, knowledge and the
 * recent window in parallel and degrades each on its own, so the risk here is a
 * cold worker rather than a slow one — and a call answered with a thin prompt
 * beats a call that never connects.
 */
const CONTEXT_DEADLINE_MS = 5000;

export async function POST(request: Request) {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  const got = request.headers.get("x-webhook-secret") ?? "";
  if (!secret || !timingSafeEqual(got, secret)) {
    return new NextResponse("invalid secret", { status: 401 });
  }

  const rawBody = await request.text();
  const payload = JSON.parse(rawBody) as VapiServerMessage;
  const msg = payload.message;
  if (msg?.type === "assistant-request") return answerInboundCall(msg);
  if (msg?.type !== "end-of-call-report") return NextResponse.json({});

  const assistantId = msg.call?.assistantId ?? msg.assistant?.id;
  const transcript = msg.artifact?.transcript ?? msg.analysis?.summary ?? "";
  if (!assistantId || !transcript) return NextResponse.json({});

  // One assistant per employee: the assistant id is the connector's address (#250).
  const employee = await resolveByAddress("vapi", assistantId);

  const eventKey = msg.call?.id
    ? `call:${msg.call.id}`
    : `body:${crypto.createHash("sha256").update(rawBody).digest("hex")}`;
  if (!(await claimWebhookEvent("vapi", `${eventKey}:end-of-call-report`))) {
    return NextResponse.json({});
  }

  if (employee) {
    // The caller's identity comes back on the report because these variables
    // were set when the call was answered — at creation for a web call (#43),
    // in `answerInboundCall` for a phone call (#252) — so the call is
    // remembered as "with <name>" rather than with nobody. A dashboard call is
    // internal by construction, a phone call is not, and neither is
    // necessarily the manager.
    const vars = msg.call?.assistantOverrides?.variableValues;
    const counterparty: Envelope["counterparty"] = vars?.caller_name
      ? {
          kind: callerKind(vars.caller_kind),
          name: vars.caller_name,
          // The cross-channel key (#174): stamping the caller's email on the
          // transcript turn is what lets their later email/Slack turns see
          // this call in their recent-conversation window.
          ...(vars.caller_address ? { address: vars.caller_address } : {}),
        }
      : undefined;

    const envelope: Envelope = {
      org_id: employee.org_id,
      employee_id: employee.employee_id,
      channel: "voice",
      ...(counterparty ? { counterparty } : {}),
      text:
        "You just finished a voice call. Transcript:\n\n" +
        transcript +
        "\n\nComplete any commitments you made using your tools, then note the outcome and key facts in a few sentences.",
    };
    // channel "voice" with no address: the worker logs the turn + writes memory
    // and the reply (the employee's call notes) lands in the activity rail.
    after(async () => {
      try {
        await dispatchTurn(envelope, { channel: "voice" });
      } catch (err) {
        console.error("[vapi] turn dispatch failed", err);
        Sentry.captureException(err);
      }
    });
  }

  return NextResponse.json({});
}

function callerKind(value: string | undefined): NonNullable<Envelope["counterparty"]>["kind"] {
  if (value === "manager") return "manager";
  if (value === "external") return "external";
  return "coworker";
}

/**
 * Say who answers an inbound phone call. The number is bought with no assistant
 * attached (`provisionPhoneNumber`) precisely so this runs: the assistant as
 * stored at Vapi holds only a fallback prompt, and it is the overrides returned
 * here that carry identity, memory, knowledge and the recent window — the same
 * bundle the in-platform call injects, so the two sound like one employee.
 */
async function answerInboundCall(msg: NonNullable<VapiServerMessage["message"]>) {
  const dialled = msg.phoneNumber?.number;
  const number = await resolveByAddress("vapi_phone", dialled);
  if (!number) {
    console.error("[vapi] assistant-request for an unknown number", dialled);
    return NextResponse.json({ error: "This number is not in service." });
  }

  const admin = createAdminClient();
  const { data: employee } = await admin
    .from("employees")
    .select("name, manager_id, identity")
    .eq("id", number.employee_id)
    .maybeSingle();

  if (!employee) {
    return NextResponse.json({ error: "This number is not in service." });
  }

  if ((employee.identity as { paused?: boolean } | null)?.paused) {
    console.warn(`[vapi] assistant-request rejected: ${employee.name} is paused`);
    return NextResponse.json({ error: "This number is not taking calls." });
  }

  const voice = await connectorFor(number.employee_id, "vapi");
  if (!voice?.address) {
    console.error("[vapi] assistant-request with no assistant", number.employee_id);
    return NextResponse.json({ error: "This number is not in service." });
  }

  const caller = msg.customer?.number;
  let callerName = caller ?? "a caller";
  let callerKind: "external" | "coworker" | "manager" = "external";
  let callerAddress = caller;

  if (caller && employee.manager_id) {
    const { data: manager } = await admin
      .from("users")
      .select(`
        name,
        email,
        manager_phone_numbers!inner (phone_number)
      `)
      .eq("id", employee.manager_id)
      .eq("manager_phone_numbers.phone_number", caller)
      .maybeSingle();

    if (manager) {
      callerKind = "manager";
      callerName = manager.name ?? callerName;
      callerAddress = manager.email ?? caller;
    }
  }

  const variableValues = {
    caller_name: callerName,
    caller_kind: callerKind,
    ...(callerAddress ? { caller_address: callerAddress } : {}),
  };

  const system = await withDeadline<string | null>(
    () =>
      fetchVoiceContext(number.org_id, number.employee_id, {
        kind: callerKind,
        name: callerName,
        ...(callerAddress ? { address: callerAddress } : {}),
      }),
    CONTEXT_DEADLINE_MS,
    null,
  );

  if (!system) {
    // Connect the call on the stored fallback prompt rather than drop it, and
    // say so loudly — a call answered by an employee with no memory is a bug,
    // just not one worth hanging up over.
    console.error("[vapi] context deadline missed, answering without it", number.employee_id);
    Sentry.captureMessage("vapi assistant-request answered without context");
    return NextResponse.json({ assistantId: voice.address });
  }

  return NextResponse.json({
    assistantId: voice.address,
    assistantOverrides: voiceOverrides(system, variableValues),
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
