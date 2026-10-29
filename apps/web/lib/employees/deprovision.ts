import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, EmployeeConnectorRow, IdentityFile } from "@ate/shared";
import { handlerFor } from "../connectors";
import { deleteInbox } from "../channels/agentmail";

/**
 * Tear down an employee's vendor resources, then delete its row (#92's
 * delete path). Order is load-bearing:
 *
 * 1. AgentMail can abort the whole delete — deleting the row after a failed
 *    inbox delete would make that inbox permanently unreachable on the vendor
 *    side. We check both `employee_connectors` and `employees` (email_address and
 *    identity.email_address) so any inbox is guaranteed to be deleted.
 *    Everything after this step is best-effort: log and continue, because the
 *    row is still going away and a stuck Slack app, Vapi assistant, or
 *    Composio grant is recoverable, an orphaned inbox is not.
 * 2. Every other connector, in whatever order its rows come back.
 * 3. Delete the row (knowledge_docs / employee_connectors / events cascade).
 */
export async function deprovision(
  admin: SupabaseClient<Database>,
  employee: { id: string; org_id: string },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [{ data: connectors }, { data: empRecord }] = await Promise.all([
    admin.from("employee_connectors").select("*").eq("employee_id", employee.id),
    admin.from("employees").select("identity").eq("id", employee.id).maybeSingle(),
  ]);

  // Collect all AgentMail inboxes across connectors and employee profile
  const agentmailInboxes = new Set<string>();

  for (const row of connectors ?? []) {
    if (row.provider === "agentmail" && row.address) {
      agentmailInboxes.add(row.address);
    } else if (row.address && row.address.endsWith("@agentmail.to")) {
      agentmailInboxes.add(row.address);
    }
  }

  const rawRecord = empRecord as { identity?: Partial<IdentityFile>; email_address?: string } | null;
  if (rawRecord?.email_address && rawRecord.email_address.endsWith("@agentmail.to")) {
    agentmailInboxes.add(rawRecord.email_address);
  }

  const identity = rawRecord?.identity;
  if (identity?.email_address && identity.email_address.endsWith("@agentmail.to")) {
    agentmailInboxes.add(identity.email_address);
  }

  for (const inboxId of agentmailInboxes) {
    try {
      await deleteInbox(inboxId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `agentmail: ${message}` };
    }
  }

  const release = (row: EmployeeConnectorRow) => handlerFor(row.provider)?.deprovision?.(row);

  for (const row of connectors ?? []) {
    if (row.provider === "agentmail") continue;
    try {
      await release(row);
    } catch (err) {
      console.error(`deprovision: ${row.provider} release failed for employee ${employee.id}`, err);
    }
  }

  const { error } = await admin.from("employees").delete().eq("id", employee.id);
  if (error) return { ok: false, reason: error.message };

  return { ok: true };
}
