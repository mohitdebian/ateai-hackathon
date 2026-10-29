import { composioClient } from "../tools.js";
import { createAdminClient } from "../supabase.js";
import { connectorFields, type ComposioCredential } from "@ate/shared";
import type { EmailTaskRow } from "@ate/shared";
import type { Mail, EmailProvider } from "./queue.js";
import { asRecord, string } from "./queue.js";

export function mailFromGmailResult(value: unknown, expectedId: string): Mail {
  const outer = asRecord(value);
  const message = "messageId" in outer ? outer : asRecord(outer.data);
  if (string(message.messageId) !== expectedId) throw new Error("Gmail returned a different message ID");

  let fromName = "";
  let from = string(message.sender);
  const match = from.match(/(.*?)\s*<(.+?)>/);
  if (match) {
    fromName = match[1].replace(/"/g, "").trim();
    from = match[2];
  }

  const attachments = message.attachmentList;
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

  return {
    id: expectedId,
    subject: string(message.subject) || "(no subject)",
    from: from || "(unknown sender)",
    fromName,
    receivedAt: string(message.messageTimestamp) || new Date().toISOString(),
    body: string(message.messageText) || "(no content)",
    hasAttachments,
  };
}

export const gmailProvider: EmailProvider = {
  name: "Gmail",
  triggerName: "GMAIL_NEW_GMAIL_MESSAGE",

  async readMail(task: EmailTaskRow): Promise<Mail> {
    const composio = composioClient();
    if (!composio || !task.message_id) throw new Error("Gmail connection is not configured");
    const result = await composio.tools.execute("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", {
      userId: task.employee_id,
      connectedAccountId: task.connected_account_id,
      version: "20260915_00",
      arguments: {
        message_id: task.message_id,
      },
    }, { signal: AbortSignal.timeout(30_000) });
    if (!result.successful) throw new Error(`Gmail read failed: ${result.error ?? "unknown error"}`);
    return mailFromGmailResult(result.data, task.message_id);
  },

  async connectionState(task: EmailTaskRow): Promise<"active" | "waiting" | "gone"> {
    const admin = createAdminClient();
    const [{ data: account, error: accountError }, { data: enabled, error: orgError }] = await Promise.all([
      admin.from("employee_connectors").select("credential,status").eq("org_id", task.org_id)
        .eq("employee_id", task.employee_id).eq("provider", "gmail").maybeSingle(),
      admin.from("org_connectors").select("status").eq("org_id", task.org_id)
        .eq("provider", "gmail").maybeSingle(),
    ]);
    if (accountError) throw accountError;
    if (orgError) throw orgError;
    if (connectorFields<ComposioCredential>(account?.credential).composio_account_id !== task.connected_account_id) {
      return "gone";
    }
    return account?.status === "active" && enabled?.status === "active" ? "active" : "waiting";
  },

  mailContext(mail: Mail): string {
    return JSON.stringify({ message_id: mail.id, from: mail.from, from_name: mail.fromName, subject: mail.subject,
      received_at: mail.receivedAt, body: mail.body.slice(0, 20_000), has_attachments: mail.hasAttachments });
  }
};
