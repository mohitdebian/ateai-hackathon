import { composioClient } from "../tools.js";
import { createAdminClient } from "../supabase.js";
import { connectorFields, type ComposioCredential } from "@ate/shared";
import type { EmailTaskRow } from "@ate/shared";
import type { Mail, EmailProvider } from "./queue.js";
import { asRecord, string } from "./queue.js";

export function mailFromOutlookResult(value: unknown, expectedId: string): Mail {
  const outer = asRecord(value);
  const message = "id" in outer ? outer : asRecord(outer.data);
  const from = asRecord(asRecord(message.from).emailAddress);
  const body = asRecord(message.body);
  if (string(message.id) !== expectedId) throw new Error("Outlook returned a different message ID");
  return {
    id: expectedId,
    subject: string(message.subject) || "(no subject)",
    from: string(from.address) || "(unknown sender)",
    fromName: string(from.name),
    receivedAt: string(message.receivedDateTime),
    body: string(body.content) || string(message.bodyPreview),
    hasAttachments: message.hasAttachments === true,
  };
}

export const outlookProvider: EmailProvider = {
  name: "Outlook",
  triggerName: "OUTLOOK_MESSAGE_TRIGGER",

  async readMail(task: EmailTaskRow): Promise<Mail> {
    const composio = composioClient();
    if (!composio || !task.message_id) throw new Error("Outlook connection is not configured");
    const result = await composio.tools.execute("OUTLOOK_GET_MESSAGE", {
      userId: task.employee_id,
      connectedAccountId: task.connected_account_id,
      version: "20260925_00",
      arguments: {
        message_id: task.message_id,
        user_id: "me",
        select: ["id", "subject", "from", "receivedDateTime", "body", "bodyPreview", "hasAttachments"],
      },
    }, { signal: AbortSignal.timeout(30_000) });
    if (!result.successful) throw new Error(`Outlook read failed: ${result.error ?? "unknown error"}`);
    return mailFromOutlookResult(result.data, task.message_id);
  },

  async connectionState(task: EmailTaskRow): Promise<"active" | "waiting" | "gone"> {
    const admin = createAdminClient();
    const [{ data: account, error: accountError }, { data: enabled, error: orgError }] = await Promise.all([
      admin.from("employee_connectors").select("credential,status").eq("org_id", task.org_id)
        .eq("employee_id", task.employee_id).eq("provider", "outlook").maybeSingle(),
      admin.from("org_connectors").select("status").eq("org_id", task.org_id)
        .eq("provider", "outlook").maybeSingle(),
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
