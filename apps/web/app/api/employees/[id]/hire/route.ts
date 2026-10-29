import { NextResponse } from "next/server";
import type { IdentityFile } from "@ate/shared";
import { connectorSpec, NATIVE_PROVIDERS } from "@ate/shared";
import { getOrgContext, isPrivileged } from "../../../../../lib/auth";
import { createAdminClient, createClient } from "../../../../../lib/supabase/server";
import { handlerFor, type StepResult } from "../../../../../lib/connectors";
import { publicAppUrl } from "../../../../../lib/env";

export const runtime = "nodejs";

/**
 * Hire: validate the human manager, then provision every connector the org has
 * turned on (`org_connectors`), and flip the employee to hired. Each handler is
 * idempotent — it skips when its `employee_connectors` row already carries an
 * address — so this same endpoint is the retry: a partial failure leaves the
 * employee unhired and the UI offers "Retry".
 *
 * A vendor whose key isn't configured is reported as `skipped`, and a step
 * waiting on a human (the Slack install click) as `action`; neither blocks
 * hiring — the demo works with whatever vendors are wired.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isPrivileged(ctx.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { force?: boolean };
  const force = Boolean(body?.force);

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: employee } = await supabase
    .from("employees")
    .select("id, org_id, name, hired_at, manager_id, identity")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });
  if (employee.hired_at) {
    return NextResponse.json({ status: "active", steps: [] });
  }

  // --- Manager rule (docs/product.md "Vision"): exactly one human manager. ---
  const managerId = employee.manager_id ?? ctx.userId;
  const { data: manager } = await supabase
    .from("users")
    .select("id")
    .eq("id", managerId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!manager) {
    return NextResponse.json(
      { error: "managers must be platform users in this org" },
      { status: 400 },
    );
  }

  const { error: managerError } = await supabase
    .from("employees")
    .update({ manager_id: managerId })
    .eq("id", id);
  if (managerError) return NextResponse.json({ error: managerError.message }, { status: 400 });

  const [{ data: enabled, error: enabledError }, { data: existing, error: existingError }] =
    await Promise.all([
      admin
        .from("org_connectors")
        .select("provider")
        .eq("org_id", employee.org_id)
        .eq("status", "active"),
      admin
        .from("employee_connectors")
        .select("id, org_id, employee_id, provider, address, credential, config, status, created_at")
        .eq("org_id", employee.org_id)
        .eq("employee_id", id),
    ]);
  if (enabledError || existingError) {
    return NextResponse.json(
      { error: "could not read the org connectors" },
      { status: 500 },
    );
  }

  const identity = { ...(employee.identity as IdentityFile) };
  const appUrl = publicAppUrl(request);
  const steps: StepResult[] = [];

  // Ordered by the registry rather than by row: email before Slack before
  // voice, as the wizard's copy promises. A connector the org has not turned
  // on, or one with no hire-time setup (a Composio toolkit), is skipped.
  const providers = NATIVE_PROVIDERS.filter((p) =>
    (enabled ?? []).some((row) => row.provider === p),
  );
  for (const provider of providers) {
    const provision = handlerFor(provider)?.provision;
    if (!provision) continue;
    // One connector must never sink the hire, so a handler that throws instead
    // of reporting (a failed row write, say) becomes its own failed step.
    try {
      steps.push(
        await provision({
          db: admin,
          employee,
          identity,
          appUrl,
          existing: (existing ?? []).find((row) => row.provider === provider) ?? null,
        }),
      );
    } catch (err) {
      steps.push({
        step: connectorSpec(provider).channel ?? provider,
        status: "failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // --- Finalize: failures leave `incomplete` + retry unless forced; skips don't block. ---
  const failed = steps.some((s) => s.status === "failed");
  const status = failed && !force ? "incomplete" : "active"; // response vocabulary only — see hire-panel.tsx
  const hired_at = failed && !force ? null : new Date().toISOString();
  identity.manager = { id: managerId };

  const { error } = await supabase
    .from("employees")
    .update({ hired_at, identity })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ status, steps });
}
