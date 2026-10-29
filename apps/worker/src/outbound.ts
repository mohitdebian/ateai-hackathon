import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, SlackCredential } from "@ate/shared";
import { connectorFields } from "@ate/shared";
import { sendEmail } from "./channels/agentmail.js";
import { openSlackDm, postSlackMessage } from "./channels/slack.js";

/** Only used when the employee sends its manager something without a subject. */
const EMAIL_SUBJECT = "Message from your employee";

export interface OutboundMessage {
  channel: "email" | "slack";
  to: string;
  subject?: string;
  text: string;
}

export interface OutboundContext {
  inboxId: string | null;
  managerEmail: string;
  managerKey: string;
  slackBotToken: string | null;
}

export function normalizeEmail(address: string): string {
  return address.trim().toLowerCase();
}

export async function loadOutboundContext(
  admin: SupabaseClient<Database>,
  orgId: string,
  employeeId: string,
): Promise<OutboundContext> {
  const [{ data: employee, error: employeeError }, { data: connectors, error: connectorError }] =
    await Promise.all([
      admin
        .from("employees")
        .select("manager_id")
        .eq("id", employeeId)
        .eq("org_id", orgId)
        .maybeSingle(),
      admin
        .from("employee_connectors")
        .select("provider,address,credential,status")
        .eq("employee_id", employeeId)
        .eq("org_id", orgId)
        .eq("status", "active"),
    ]);
  if (employeeError) throw new Error(`manager employee lookup failed: ${employeeError.message}`);
  if (connectorError) throw new Error(`employee connector lookup failed: ${connectorError.message}`);
  if (!employee?.manager_id) throw new Error("employee has no manager");

  const { data: manager, error: managerError } = await admin
    .from("users")
    .select("email")
    .eq("id", employee.manager_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (managerError) throw new Error(`manager contact lookup failed: ${managerError.message}`);
  if (!manager?.email) throw new Error("manager has no email address");

  const inboxId = (connectors ?? []).find((row) => row.provider === "agentmail")?.address ?? null;
  const slack = (connectors ?? []).find((row) => row.provider === "slack");
  const slackBotToken = connectorFields<SlackCredential>(slack?.credential).bot_token ?? null;

  return {
    inboxId: inboxId ?? null,
    managerEmail: manager.email.trim(),
    managerKey: normalizeEmail(manager.email),
    slackBotToken,
  };
}

/**
 * Tell a channel from a person (#275). Slack channel ids start C, G or D; a
 * name arrives as "#dispatch". Anything else is an address.
 */
export function asSlackChannel(to: string): string | null {
  if (to.startsWith("#")) return to;
  return /^[CGD][A-Z0-9]{7,}$/.test(to) ? to : null;
}

async function managerSlackUserId(email: string, botToken: string): Promise<string> {
  const res = await fetch(
    `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
    { headers: { authorization: `Bearer ${botToken}` }, signal: AbortSignal.timeout(30_000) },
  );
  const body = (await res.json()) as { ok: boolean; error?: string; user?: { id?: string } };
  if (!body.ok || !body.user?.id) {
    throw new Error(`slack users.lookupByEmail failed: ${body.error ?? "missing user"}`);
  }
  return body.user.id;
}

export async function sendMessage(
  context: OutboundContext,
  message: OutboundMessage,
): Promise<"email" | "slack"> {
  const to = message.to.trim();
  if (!to) throw new Error("send_message requires a recipient");
  if (!message.text.trim()) throw new Error("send_message requires text");

  // A channel is a place, not a person: it takes no subject, and there is
  // nothing to fall back to — "#dispatch" is not an address (#275).
  const channel = message.channel === "slack" ? asSlackChannel(to) : null;
  if (channel) {
    if (!context.slackBotToken) {
      throw new Error(`send_message cannot post to ${channel}: Slack is not connected`);
    }
    await postSlackMessage(channel, message.text, context.slackBotToken);
    return "slack";
  }

  const isManager = normalizeEmail(to) === context.managerKey;
  if (!isManager && !message.subject?.trim()) {
    throw new Error("send_message requires a subject for another recipient");
  }

  if (message.channel === "slack") {
    if (!isManager) throw new Error("send_message can only send Slack messages to your manager");
    if (context.slackBotToken) {
      try {
        const userId = await managerSlackUserId(context.managerEmail, context.slackBotToken);
        const channel = await openSlackDm(userId, context.slackBotToken);
        await postSlackMessage(channel, message.text, context.slackBotToken);
        return "slack";
      } catch (err) {
        console.error("[outbound] Slack DM unavailable, falling back to email", err);
      }
    }
  }

  if (!context.inboxId) throw new Error("employee has no active email inbox");
  await sendEmail(context.inboxId, to, message.subject?.trim() || EMAIL_SUBJECT, message.text);
  return "email";
}

/** Strict Slack DM for event-driven work: never silently fall back to email. */
export async function sendManagerSlack(
  admin: SupabaseClient<Database>,
  orgId: string,
  employeeId: string,
  text: string,
): Promise<{ channel: string; ts: string }> {
  const context = await loadOutboundContext(admin, orgId, employeeId);
  if (!context.slackBotToken) throw new Error("employee has no active Slack bot");
  const userId = await managerSlackUserId(context.managerEmail, context.slackBotToken);
  const channel = await openSlackDm(userId, context.slackBotToken);
  const ts = await postSlackMessage(channel, text, context.slackBotToken);
  return { channel, ts };
}
