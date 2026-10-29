import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, EmployeeConnectorRow, IdentityFile } from "@ate/shared";
import { deleteInbox } from "../channels/agentmail";
import { handlerFor } from "../connectors";

/**
 * Tear down an entire organization and all its vendor resources (#250).
 *
 * 1. Collect and delete all AgentMail inboxes across all employees and connectors
 *    in the organization before touching the DB.
 * 2. Release all other employee connectors (Slack apps, Vapi assistants, Composio accounts).
 * 3. Delete the organization row (cascades to all child DB tables).
 * 4. Clean up the organization's users from Supabase Auth.
 */
export async function deprovisionOrganization(
  admin: SupabaseClient<Database>,
  orgId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Fetch employees, connectors, and users for this organization
  const [{ data: employees, error: empError }, { data: connectors, error: connError }, { data: users, error: userError }] =
    await Promise.all([
      admin.from("employees").select("id, org_id, identity").eq("org_id", orgId),
      admin.from("employee_connectors").select("*").eq("org_id", orgId),
      admin.from("users").select("id").eq("org_id", orgId),
    ]);

  if (empError) return { ok: false, reason: `failed to query employees: ${empError.message}` };
  if (connError) return { ok: false, reason: `failed to query connectors: ${connError.message}` };
  if (userError) return { ok: false, reason: `failed to query users: ${userError.message}` };

  // 1. Collect all AgentMail inboxes in this org
  const agentmailInboxes = new Set<string>();

  for (const row of connectors ?? []) {
    if (row.provider === "agentmail" && row.address) {
      agentmailInboxes.add(row.address);
    } else if (row.address && row.address.endsWith("@agentmail.to")) {
      agentmailInboxes.add(row.address);
    }
  }

  for (const emp of employees ?? []) {
    const rawEmp = emp as { identity?: Partial<IdentityFile>; email_address?: string };
    if (rawEmp.email_address && rawEmp.email_address.endsWith("@agentmail.to")) {
      agentmailInboxes.add(rawEmp.email_address);
    }
    const identity = rawEmp.identity;
    if (identity?.email_address && identity.email_address.endsWith("@agentmail.to")) {
      agentmailInboxes.add(identity.email_address);
    }
  }

  // Delete all AgentMail inboxes first. If AgentMail fails, abort before DB deletion.
  for (const inboxId of agentmailInboxes) {
    try {
      await deleteInbox(inboxId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `agentmail: ${message}` };
    }
  }

  // 2. Release other connectors (Slack apps, Vapi assistants, Composio, etc.)
  const release = (row: EmployeeConnectorRow) => handlerFor(row.provider)?.deprovision?.(row);
  for (const row of connectors ?? []) {
    if (row.provider === "agentmail") continue;
    try {
      await release(row);
    } catch (err) {
      console.error(`deprovisionOrganization: ${row.provider} release failed for connector ${row.id}`, err);
    }
  }

  // 3. Delete the organization row (cascades across all tables in Postgres)
  const { error: orgDeleteError } = await admin
    .from("organizations")
    .delete()
    .eq("id", orgId);

  if (orgDeleteError) {
    return { ok: false, reason: `failed to delete organization: ${orgDeleteError.message}` };
  }

  // 4. Clean up auth users from Supabase Auth
  for (const u of users ?? []) {
    try {
      await admin.auth.admin.deleteUser(u.id);
    } catch (err) {
      console.warn(`deprovisionOrganization: could not delete auth user ${u.id}`, err);
    }
  }

  return { ok: true };
}
