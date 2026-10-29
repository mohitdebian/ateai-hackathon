import { NextResponse } from "next/server";
import { getOrgContext } from "../../../lib/auth";
import { createAdminClient, createClient } from "../../../lib/supabase/server";
import { deprovisionOrganization } from "../../../lib/org/deprovision";

export const runtime = "nodejs";

/**
 * Delete an entire organization, releasing all AgentMail inboxes, external
 * connectors (Slack, Vapi, Composio), cascading database rows, and cleaning up
 * users from Supabase Auth. Only organization admins may execute this.
 */
export async function DELETE() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (ctx.role !== "admin") {
    return NextResponse.json(
      { error: "forbidden: only admins can delete an organization" },
      { status: 403 },
    );
  }

  const admin = createAdminClient();
  const result = await deprovisionOrganization(admin, ctx.orgId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: 503 },
    );
  }

  // Clear session cookies so the client isn't left in an unauthenticated limbo
  const supabase = await createClient();
  await supabase.auth.signOut().catch(() => {});

  return NextResponse.json({ ok: true });
}
