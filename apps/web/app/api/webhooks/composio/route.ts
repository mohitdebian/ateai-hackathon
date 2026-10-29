import { NextResponse, after } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/server";
import { verifyComposioSignature } from "../../../../lib/webhooks/composio";
import { dispatchEmailTasks } from "../../../../lib/worker";

export const runtime = "nodejs";

/**
 * Composio project-events webhook. Composio has no "revoked" event, so the
 * closest signal that a grant has stopped working is
 * `composio.connected_account.expired`. We mark the row `expired` rather than
 * deleting it: the worker only loads tools for `status = "active"`, so the
 * employee drops the toolkit on its next turn and stops claiming access it
 * doesn't have (#206), while the row survives for the profile to offer a
 * reconnect. Outlook message events become durable worker tasks.
 */

interface ComposioWebhook {
  id?: string;
  type?: string;
  metadata?: { connected_account_id?: string; trigger_slug?: string; user_id?: string };
  data?: { id?: string; message_id?: string; connected_account_id?: string; trigger_name?: string; disabled_reason?: string };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const ok = verifyComposioSignature(
    rawBody,
    request.headers.get("webhook-id"),
    request.headers.get("webhook-timestamp"),
    request.headers.get("webhook-signature"),
  );
  if (!ok) return new NextResponse("invalid signature", { status: 401 });

  let payload: ComposioWebhook;
  try {
    payload = JSON.parse(rawBody) as ComposioWebhook;
  } catch {
    return new NextResponse("invalid JSON", { status: 400 });
  }
  if (!payload || typeof payload !== "object") return new NextResponse("invalid event", { status: 400 });
  const accountId = payload.type === "composio.connected_account.expired"
    ? payload.data?.id
    : payload.data?.connected_account_id;

  if (payload.type === "composio.connected_account.expired" && accountId) {
    const admin = createAdminClient();
    const { error } = await admin
      .from("employee_connectors")
      .update({ status: "expired" })
      .eq("credential->>composio_account_id", accountId);
    if (error) {
      console.error("[composio-webhook] expire failed", error);
      return new NextResponse("retry", { status: 500 });
    }
  }

  if (payload.type === "composio.trigger.disabled" &&
      (payload.data?.trigger_name === "OUTLOOK_MESSAGE_TRIGGER" || payload.data?.trigger_name === "GMAIL_NEW_GMAIL_MESSAGE") && accountId) {
    const admin = createAdminClient();
    const provider = payload.data.trigger_name === "OUTLOOK_MESSAGE_TRIGGER" ? "outlook" : "gmail";
    const { data: connection, error: lookupError } = await admin.from("employee_connectors")
      .select("org_id,employee_id").eq("provider", provider)
      .eq("credential->>composio_account_id", accountId).maybeSingle();
    if (lookupError) throw lookupError;
    if (connection) {
      const { error } = await admin.from("events").insert({
        org_id: connection.org_id,
        employee_id: connection.employee_id,
        channel: "email",
        kind: "message",
        payload: { direction: "system", degraded: `${provider}_trigger`,
          text: `${provider} monitoring stopped: ${payload.data.disabled_reason ?? "unknown reason"}` },
      });
      if (error) throw error;
      if (payload.id) {
        const { error: taskError } = await admin.from("email_tasks").upsert({
          org_id: connection.org_id,
          employee_id: connection.employee_id,
          connected_account_id: accountId,
          task_key: `alert:${payload.id}`,
          summary: payload.data.disabled_reason ?? "unknown reason",
          provider,
        }, { onConflict: "connected_account_id,task_key", ignoreDuplicates: true });
        if (taskError) throw taskError;
        after(() => dispatchEmailTasks().catch((err) => console.error(`[composio-webhook] ${provider} alert wake failed`, err)));
      }
    }
  }

  if (payload.type === "composio.trigger.message" &&
      (payload.metadata?.trigger_slug === "OUTLOOK_MESSAGE_TRIGGER" || payload.metadata?.trigger_slug === "GMAIL_NEW_GMAIL_MESSAGE")) {
    const connectedAccountId = payload.metadata.connected_account_id;
    // Outlook triggers use `id`, Gmail triggers use `message_id`.
    const messageId = payload.data?.message_id ?? payload.data?.id;
    const provider = payload.metadata.trigger_slug === "OUTLOOK_MESSAGE_TRIGGER" ? "outlook" : "gmail";
    if (!connectedAccountId || !messageId) return new NextResponse(`invalid ${provider} event`, { status: 400 });
    const admin = createAdminClient();
    const { data: connection, error: lookupError } = await admin.from("employee_connectors")
      .select("org_id,employee_id").eq("provider", provider).eq("status", "active")
      .eq("credential->>composio_account_id", connectedAccountId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!connection) return new NextResponse("", { status: 200 });
    if (payload.metadata.user_id && payload.metadata.user_id !== connection.employee_id) {
      console.error(`[composio-webhook] ${provider} account owner mismatch`);
      return new NextResponse("account owner mismatch", { status: 400 });
    }
    const { data: enabled, error: enabledError } = await admin.from("org_connectors")
      .select("id").eq("org_id", connection.org_id).eq("provider", provider)
      .eq("status", "active").maybeSingle();
    if (enabledError) throw enabledError;
    if (!enabled) return new NextResponse("", { status: 200 });
    const { error: taskError } = await admin.from("email_tasks").upsert({
      org_id: connection.org_id,
      employee_id: connection.employee_id,
      connected_account_id: connectedAccountId,
      task_key: `message:${messageId}`,
      message_id: messageId,
      provider,
    }, { onConflict: "connected_account_id,task_key", ignoreDuplicates: true });
    if (taskError) throw taskError;
    after(() => dispatchEmailTasks().catch((err) => console.error(`[composio-webhook] ${provider} wake failed`, err)));
  }

  return new NextResponse("", { status: 200 });
}
