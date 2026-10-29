import { NextResponse, after } from "next/server";
import type { Envelope, SlackCredential } from "@ate/shared";
import { connectorFields } from "@ate/shared";
import { dispatchTurn } from "../../../../lib/worker";
import { resolveByAddress } from "../../../../lib/connectors/lookup";
import { verifySlackSignature, stripMention } from "../../../../lib/channels/slack";
import { resolveBySlackUser } from "../../../../lib/counterparty";
import { claimWebhookEvent } from "../../../../lib/webhooks/idempotency";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "../../../../lib/supabase/server";
import { dispatchEmailTasks } from "../../../../lib/worker";

export const runtime = "nodejs";

/**
 * Slack Events API webhook — one endpoint for every employee's app. The
 * event's api_app_id is the Slack connector's address (#250), so it picks the
 * row whose signing secret verifies the request and whose bot token the worker
 * replies with. Acks within Slack's 3s window and runs the turn async.
 */
interface SlackEventPayload {
  type?: string;
  challenge?: string;
  api_app_id?: string;
  event_id?: string;
  event?: {
    type?: string;
    bot_id?: string;
    subtype?: string;
    user?: string;
    text?: string;
    channel?: string;
    thread_ts?: string;
  };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  let payload: SlackEventPayload;
  try {
    payload = JSON.parse(rawBody) as SlackEventPayload;
  } catch {
    return new NextResponse("invalid JSON", { status: 400 });
  }

  // URL verification handshake — Slack sends it when a new employee app is
  // created with this request_url, before we know which app it is. Echoing the
  // challenge is side-effect free, so it's answered without a signature check.
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  const connector = await resolveByAddress("slack", payload.api_app_id);
  const credential = connectorFields<SlackCredential>(connector?.credential);
  // No global fallback secret (#71): an event we cannot tie to an employee's
  // own signing secret is rejected rather than verified against a shared bot.
  const signingSecret = credential.signing_secret ?? null;
  const ok =
    signingSecret !== null &&
    verifySlackSignature(
      signingSecret,
      rawBody,
      request.headers.get("x-slack-signature"),
      request.headers.get("x-slack-request-timestamp"),
    );
  if (!ok) return new NextResponse("invalid signature", { status: 401 });

  // Backstop for deliveries with no event_id to claim: any retry is a duplicate.
  if (!payload.event_id && request.headers.get("x-slack-retry-num")) {
    return new NextResponse("", { status: 200 });
  }

  if (payload.type === "event_callback" && connector) {
    const event = payload.event;
    const isUserMessage = Boolean(
      (event?.type === "app_mention" || event?.type === "message") &&
      !event.bot_id &&
      !event.subtype &&
      event.channel,
    );

    if (isUserMessage && event?.channel) {
      // Slack only gives a user id, so resolve it against the employee's
      // manager via users.info (#43). Degrades to `external` on missing scope.
      const counterparty = await resolveBySlackUser(
        connector.employee_id,
        event.user ?? "",
        credential.bot_token ?? null,
      );
      const { data: outlookTask, error: outlookError } =
        counterparty.kind === "manager" && event.thread_ts
          ? await createAdminClient().from("email_tasks").select("connected_account_id,message_id,provider")
              .eq("org_id", connector.org_id).eq("employee_id", connector.employee_id)
              .eq("slack_channel", event.channel).eq("slack_ts", event.thread_ts)
              .eq("status", "waiting").maybeSingle()
          : { data: null, error: null };
      if (outlookError) throw outlookError;
      const managerText = stripMention(event.text ?? "");
      if (outlookTask) {
        if (!payload.event_id) return new NextResponse("missing Slack event ID", { status: 400 });
        const { error } = await createAdminClient().from("email_tasks").upsert({
          org_id: connector.org_id,
          employee_id: connector.employee_id,
          connected_account_id: outlookTask.connected_account_id,
          task_key: `reply:${payload.event_id}`,
          message_id: outlookTask.message_id,
          summary: managerText,
          slack_channel: event.channel,
          slack_ts: event.thread_ts,
          provider: outlookTask.provider,
        }, { onConflict: "connected_account_id,task_key", ignoreDuplicates: true });
        if (error) throw error;
        after(() => dispatchEmailTasks().catch((err: unknown) => console.error("[slack] Outlook reply wake failed", err)));
        return new NextResponse("", { status: 200 });
      }
      // Resolve the bound thread before claiming: a DB failure must let Slack retry.
      if (payload.event_id && !(await claimWebhookEvent("slack", payload.event_id))) {
        return new NextResponse("", { status: 200 });
      }
      const envelope: Envelope = {
        org_id: connector.org_id,
        employee_id: connector.employee_id,
        channel: "slack",
        text: managerText,
        counterparty,
      };
      // Hand off after the 200 ack. dispatchTurn returns as soon as the worker
      // accepts (202); the worker runs the turn and posts the reply to Slack
      // itself, so this callback finishes in milliseconds.
      after(async () => {
        try {
          await dispatchTurn(envelope, {
            channel: "slack",
            slack_channel: event.channel,
            ...(event.thread_ts ? { slack_thread_ts: event.thread_ts } : {}),
            slack_bot_token: credential.bot_token,
          });
        } catch (err) {
          console.error("[slack] turn dispatch failed", err);
          Sentry.captureException(err);
        }
      });
    }
  }

  return new NextResponse("", { status: 200 });
}
