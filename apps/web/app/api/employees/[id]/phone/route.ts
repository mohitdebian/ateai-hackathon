import { NextResponse } from "next/server";
import type { IdentityFile, VapiPhoneConfig } from "@ate/shared";
import { connectorFields } from "@ate/shared";
import { getOrgContext } from "../../../../../lib/auth";
import { createAdminClient, createClient } from "../../../../../lib/supabase/server";
import {
  phoneNumberStatus,
  provisionPhoneNumber,
  releasePhoneNumber,
} from "../../../../../lib/channels/vapi";
import { hasEnv, publicAppUrl } from "../../../../../lib/env";
import { isRateLimited, withRetry } from "../../../../../lib/retry";

export const runtime = "nodejs";

/**
 * Give one employee a phone number, or take it back (#252). Not part of hire:
 * a number costs money every month and most employees need none, so this is a
 * button on the profile rather than a step every hire runs.
 *
 * The number is bought with no assistant attached, so every call to it asks
 * `/api/webhooks/vapi` who should answer — see `provisionPhoneNumber`.
 *
 * A new number spends a minute or two "activating", during which the carrier
 * rejects calls to it, and Vapi sends no callback when that ends. So the row
 * starts `pending` and GET asks Vapi whether it has gone live — the profile
 * polls that rather than showing a number nobody can call yet.
 */

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const supabase = await createClient();

  // RLS only constrains org_id, so it cannot catch an employee_id from another
  // tenant — confirm the row is visible to this caller before writing to it.
  const { data: employee } = await supabase
    .from("employees")
    .select("id, org_id, name, hired_at, identity")
    .eq("id", id)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });
  if (!employee.hired_at) {
    return NextResponse.json({ error: "employee is not hired yet" }, { status: 409 });
  }
  if (!hasEnv("VAPI_API_KEY")) {
    return NextResponse.json({ error: "VAPI_API_KEY not configured" }, { status: 409 });
  }

  // org_connectors is service-role only, scoped to the org of the RLS-checked
  // employee above. No row means this client does not buy numbers.
  const { data: enabled } = await createAdminClient()
    .from("org_connectors")
    .select("provider")
    .eq("org_id", employee.org_id)
    .eq("provider", "vapi_phone")
    .eq("status", "active")
    .maybeSingle();
  if (!enabled) {
    return NextResponse.json({ error: "this org does not have phone numbers" }, { status: 409 });
  }

  const { data: rows } = await supabase
    .from("employee_connectors")
    .select("provider, address, status")
    .eq("employee_id", id)
    .in("provider", ["vapi", "vapi_phone"]);

  // Idempotent: a second click returns the number rather than buying another.
  const existing = (rows ?? []).find((row) => row.provider === "vapi_phone");
  if (existing?.address) {
    return NextResponse.json({ number: existing.address, status: existing.status });
  }

  const voiceConnector = (rows ?? []).find((row) => row.provider === "vapi" && row.address);
  if (!voiceConnector?.address) {
    return NextResponse.json({ error: "voice is not provisioned" }, { status: 409 });
  }

  try {
    const { id: phoneNumberId, number, status } = await withRetry(
      () =>
        provisionPhoneNumber(
          employee.name,
          `${publicAppUrl(request)}/api/webhooks/vapi`,
          voiceConnector.address,
        ),
      { attempts: 4, isRetryable: isRateLimited },
    );

    const { error } = await supabase.from("employee_connectors").upsert(
      {
        org_id: employee.org_id,
        employee_id: id,
        provider: "vapi_phone",
        address: number,
        config: { phone_number_id: phoneNumberId },
        status: status === "active" ? "active" : "pending",
      },
      { onConflict: "employee_id,provider" },
    );
    // The row is the only place the number's id lives, so a failed write leaves
    // a number nothing can release. Hand it back rather than orphan it.
    if (error) {
      await releasePhoneNumber(phoneNumberId).catch(() => {});
      throw new Error(error.message);
    }

    // Only once it is callable does the number belong in the soul file — until
    // then the employee would be handing out a number that declines.
    if (status === "active") {
      await writeIdentityNumber(supabase, id, employee.identity as IdentityFile, number);
    }
    return NextResponse.json({ number, status: status === "active" ? "active" : "pending" });
  } catch (err) {
    console.error("[vapi] provision phone number failed", err);
    // Internal tool, signed-in members only: the vendor's reason is usually
    // the free-number cap or a missing payment method, which is worth seeing.
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `could not get a number — ${detail}` }, { status: 502 });
  }
}

/** Has the number finished activating? Flips the row and the soul file when it has. */
export async function GET(_request: Request, { params }: Params) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const supabase = await createClient();
  const { data: employee } = await supabase
    .from("employees")
    .select("id, identity")
    .eq("id", id)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });

  const { data: row } = await supabase
    .from("employee_connectors")
    .select("address, config, status")
    .eq("employee_id", id)
    .eq("provider", "vapi_phone")
    .maybeSingle();
  if (!row) return NextResponse.json({ number: null, status: null });
  if (row.status === "active") return NextResponse.json({ number: row.address, status: "active" });

  const { phone_number_id } = connectorFields<VapiPhoneConfig>(row.config);
  const live = phone_number_id ? await phoneNumberStatus(phone_number_id) : null;
  if (live !== "active") {
    return NextResponse.json({ number: row.address, status: "pending" });
  }

  await supabase
    .from("employee_connectors")
    .update({ status: "active" })
    .eq("employee_id", id)
    .eq("provider", "vapi_phone");
  if (row.address) {
    await writeIdentityNumber(supabase, id, employee.identity as IdentityFile, row.address);
  }
  return NextResponse.json({ number: row.address, status: "active" });
}

export async function DELETE(_request: Request, { params }: Params) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const supabase = await createClient();
  const { data: employee } = await supabase
    .from("employees")
    .select("id, identity")
    .eq("id", id)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });

  const { data: row } = await supabase
    .from("employee_connectors")
    .select("config")
    .eq("employee_id", id)
    .eq("provider", "vapi_phone")
    .maybeSingle();
  if (!row) return NextResponse.json({ ok: true });

  const { phone_number_id } = connectorFields<VapiPhoneConfig>(row.config);
  try {
    if (phone_number_id) await releasePhoneNumber(phone_number_id);
  } catch (err) {
    console.error("[vapi] release phone number failed", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `could not release the number — ${detail}` }, { status: 502 });
  }

  const { error } = await supabase
    .from("employee_connectors")
    .delete()
    .eq("employee_id", id)
    .eq("provider", "vapi_phone");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await writeIdentityNumber(supabase, id, employee.identity as IdentityFile, undefined);
  return NextResponse.json({ ok: true });
}

/**
 * Keep the soul file in step with the connector row, the way the email handler
 * does — it is what lets the employee say its own number out loud and sign an
 * email with it, on every channel rather than only on the call.
 */
async function writeIdentityNumber(
  supabase: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  identity: IdentityFile,
  number: string | undefined,
): Promise<void> {
  const next = { ...identity };
  if (number) next.phone_number = number;
  else delete next.phone_number;
  await supabase.from("employees").update({ identity: next }).eq("id", employeeId);
}
