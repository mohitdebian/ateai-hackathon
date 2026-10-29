import { NextResponse } from "next/server";
import type { IdentityFile } from "@ate/shared";
import { getOrgContext } from "../../../../../lib/auth";
import { createAdminClient } from "../../../../../lib/supabase/server";
import { createVapiAssistant, createVapiWebCall } from "../../../../../lib/channels/vapi";
import { fetchVoiceContext } from "../../../../../lib/worker";
import { isManagerOf } from "../../../../../lib/counterparty";
import { publicAppUrl } from "../../../../../lib/env";

export const runtime = "nodejs";

/**
 * Create the "Talk to me" web call server-side (#43). `caller_kind` decides
 * whether the assistant treats this call as its manager — deciding that from
 * a value the browser could set (as the old client-side `vapi.start(...,
 * { variableValues })` call did) let any signed-in org member claim to be the
 * manager. The browser only ever gets back a join URL for a call whose
 * variables are already fixed.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const supabase = createAdminClient();
  const { data: employee } = await supabase
    .from("employees")
    .select("id, name, identity")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });
  if (employee.identity?.paused) {
    return NextResponse.json(
      { error: `Cannot start call: ${employee.name} is paused` },
      { status: 409 },
    );
  }

  const { data: voice } = await supabase
    .from("employee_connectors")
    .select("address")
    .eq("employee_id", id)
    .eq("provider", "vapi")
    .maybeSingle();

  let assistantAddress = voice?.address;
  if (!assistantAddress) {
    if (process.env.VAPI_API_KEY) {
      try {
        const appUrl = publicAppUrl(_request);
        assistantAddress = await createVapiAssistant(
          employee.name,
          (employee.identity as IdentityFile) ?? {},
          `${appUrl}/api/webhooks/vapi`,
        );
        const admin = createAdminClient();
        await admin.from("employee_connectors").upsert({
          org_id: ctx.orgId,
          employee_id: employee.id,
          provider: "vapi",
          address: assistantAddress,
          status: "active",
        });
      } catch (provErr) {
        console.error("[vapi] on-demand assistant creation failed:", provErr);
        return NextResponse.json(
          { error: `Could not provision voice assistant: ${provErr instanceof Error ? provErr.message : String(provErr)}` },
          { status: 502 },
        );
      }
    } else {
      return NextResponse.json(
        { error: "Voice calling is not configured. Please set VAPI_API_KEY in Vercel Environment Variables." },
        { status: 409 },
      );
    }
  }

  const isManager = await isManagerOf(employee.id, ctx.userId);
  const callerName = ctx.name ?? ctx.email ?? "a colleague";
  const callerKind = isManager ? ("manager" as const) : ("coworker" as const);

  try {
    // Built fresh per call — identity + memory + knowledge + recent
    // conversation — so the call knows everything trained since hire (#119).
    // The caller's email is the cross-channel key the recent-conversation
    // window matches on (#174) — without it the call can't surface in this
    // person's later email/Slack turns, or vice versa.
    let system: string | undefined;
    try {
      system = await fetchVoiceContext(ctx.orgId, employee.id, {
        kind: callerKind,
        name: callerName,
        ...(ctx.email ? { address: ctx.email.toLowerCase() } : {}),
      });
    } catch (workerErr) {
      console.warn(
        `[vapi] worker /context unreachable for employee ${employee.id}; answering call with default assistant prompt:`,
        workerErr,
      );
    }

    const call = await createVapiWebCall(assistantAddress, system, {
      caller_name: callerName,
      caller_kind: callerKind,
      ...(ctx.email ? { caller_address: ctx.email.toLowerCase() } : {}),
    });
    return NextResponse.json(call);
  } catch (err) {
    console.error("[vapi] create call failed", err);
    // Internal tool, signed-in org members only: pass the vendor's reason
    // through so "could not start call" isn't the whole story (#96). It already
    // carries the Vapi status and body, which is usually a missing key.
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `could not start call — ${detail}` }, { status: 502 });
  }
}
