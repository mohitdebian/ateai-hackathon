import { NextResponse } from "next/server";
import type { IdentityFile } from "@ate/shared";
import { getOrgContext } from "../../../../../lib/auth";
import { createClient } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST /api/employees/[id]/pause
 * Pause or resume an employee. Persists to employees.identity jsonb.
 * When paused, all incoming turns (chat, calls, webhooks) fail-closed.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const paused = Boolean((body as { paused?: boolean })?.paused);

  const supabase = await createClient();
  const { data: employee, error: fetchErr } = await supabase
    .from("employees")
    .select("id, org_id, name, identity")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!employee) {
    return NextResponse.json({ error: "employee not found" }, { status: 404 });
  }

  const identity: IdentityFile = {
    ...(employee.identity as IdentityFile),
    paused,
    paused_at: paused ? new Date().toISOString() : null,
  };

  const { error: updateErr } = await supabase
    .from("employees")
    .update({ identity })
    .eq("id", id)
    .eq("org_id", ctx.orgId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    paused,
    paused_at: identity.paused_at,
  });
}
