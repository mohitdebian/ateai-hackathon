import { NextResponse } from "next/server";
import type { IdentityFile } from "@ate/shared";
import { getOrgContext } from "../../../../lib/auth";
import { createAdminClient, createClient } from "../../../../lib/supabase/server";
import { deprovision } from "../../../../lib/employees/deprovision";

export const runtime = "nodejs";

/**
 * Edit the parts of the soul file the run fills in after the row exists (#25):
 * onboard reviews scope of work and daily responsibilities, give-access sets the
 * email username and Slack handle hire will request. Merges into `identity`
 * rather than replacing it, and takes nothing else — the manager is validated
 * once, at creation, and provisioned columns belong to hire.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await request.json();
  const patch: Partial<IdentityFile> = {};
  if (typeof body.scope_of_work === "string") patch.scope_of_work = body.scope_of_work;
  if (Array.isArray(body.daily_responsibilities)) {
    patch.daily_responsibilities = body.daily_responsibilities.map(String).filter(Boolean);
  }
  if (Array.isArray(body.operating_rules)) {
    patch.operating_rules = body.operating_rules.map(String).filter(Boolean);
  }
  if (typeof body.email_address === "string") patch.email_address = body.email_address;
  if (typeof body.slack_handle === "string") patch.slack_handle = body.slack_handle;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: employee } = await supabase
    .from("employees")
    .select("id, hired_at, identity")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });
  // Once hired, the inbox and Slack app exist vendor-side and these fields
  // describe them — editing a working employee is a different feature.
  if (employee.hired_at) {
    return NextResponse.json({ error: "cannot edit an active employee here" }, { status: 409 });
  }

  const identity = { ...(employee.identity as IdentityFile), ...patch };
  const { error } = await supabase
    .from("employees")
    .update({ identity })
    .eq("id", id)
    .eq("org_id", ctx.orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

/**
 * Delete an employee, hired or not. Teardown now always runs real vendor
 * cleanup first via `deprovision()`, which releases every connector the
 * employee holds, rather than refusing hired employees outright. An AgentMail
 * failure returns 503 and leaves the row intact (retryable) instead of a 200
 * that implies the employee is gone — deleting the row would make an undeleted
 * inbox permanently unreachable, since the row is the only place the inbox id
 * lives.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const supabase = await createClient();
  const { data: employee } = await supabase
    .from("employees")
    .select("id, org_id")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });

  const admin = createAdminClient();
  const result = await deprovision(admin, employee);
  if (!result.ok) {
    return NextResponse.json(
      { error: "could not release the email inbox — try again" },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true });
}
