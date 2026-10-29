import { NextResponse, after } from "next/server";
import { OpenAIProvider, type ToolRouterSession } from "@composio/core";
import type { ComposioCredential } from "@ate/shared";
import { COMPOSIO_PROVIDER, connectorFields, connectorSpec } from "@ate/shared";
import { getOrgContext, isPrivileged } from "../../../../../lib/auth";
import { createAdminClient, createClient } from "../../../../../lib/supabase/server";
import { composio, revokeToolkit } from "../../../../../lib/composio";
import { hasEnv, publicAppUrl } from "../../../../../lib/env";
import { dispatchEmailTasks } from "../../../../../lib/worker";

export const runtime = "nodejs";

/**
 * Grant access step. POST starts a Composio managed-OAuth flow and returns the
 * redirect URL without writing anything; GET records the toolkits Composio
 * reports as connected. Nothing is stored until the flow completes, so an
 * abandoned OAuth leaves no half-connected app behind (#156).
 *
 * A grant writes two rows (#250): the employee's `employee_connectors` row, and
 * the org's `org_connectors` row saying the client has that toolkit turned on —
 * which is what the worker gates tools on, so removing the org row takes the
 * toolkit off every employee at once.
 */

/**
 * Composio caps this at 50 and 400s on anything higher — one page still covers
 * any realistic number of grants for a single employee.
 */
const MAX_CONNECTIONS = 50;

type Params = { params: Promise<{ id: string }> };
/** See apps/worker/src/tools.ts — the SDK's session type omits `requestOptions`. */
type ComposioSession = ToolRouterSession<unknown, unknown, OpenAIProvider>;

export async function GET(_request: Request, { params }: Params) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const supabase = await createClient();

  // RLS only constrains the org_id column, so it cannot catch an employee_id
  // from another tenant. Confirm the employee is visible to this caller before
  // writing any row keyed to it.
  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });

  if (isPrivileged(ctx.role) && hasEnv("COMPOSIO_API_KEY")) {
    try {
      const session = await composio().create(id, { manageConnections: false }, { signal: AbortSignal.timeout(30_000) }) as ComposioSession;
      const { items } = await session.toolkits({ isConnected: true, limit: MAX_CONNECTIONS }, { signal: AbortSignal.timeout(30_000) });
      const providers = items.map((item) => item.slug.toLowerCase());
      if (providers.length > 0) {
        const admin = createAdminClient();
        const { error } = await admin.from("employee_connectors").upsert(
          items.map((item) => {
            const accountId = item.connection?.connectedAccount?.id;
            return {
              org_id: ctx.orgId,
              employee_id: id,
              provider: item.slug.toLowerCase(),
              credential: accountId ? { composio_account_id: accountId } : null,
              status: "active" as const,
            };
          }),
          { onConflict: "employee_id,provider" },
        );
        if (error) throw error;
        const { error: orgConnectorError } = await admin
          .from("org_connectors")
          .upsert(
            providers.map((provider) => ({ org_id: ctx.orgId, provider })),
            { onConflict: "org_id,provider", ignoreDuplicates: true },
          );
        if (orgConnectorError) throw orgConnectorError;

        const emailProviders = ["outlook", "gmail"] as const;
        for (const emailProvider of emailProviders) {
          const item = items.find((i) => i.slug.toLowerCase() === emailProvider);
          if (item) {
            const accountId = item.connection?.connectedAccount?.id;
            if (!accountId) throw new Error(`Composio did not return the ${emailProvider} connected account ID`);
            const { error: taskError } = await admin.from("email_tasks").upsert({
              provider: emailProvider,
              org_id: ctx.orgId,
              employee_id: id,
              connected_account_id: accountId,
              task_key: "setup",
            }, { onConflict: "connected_account_id,task_key", ignoreDuplicates: true });
            if (taskError) throw taskError;
            after(() => dispatchEmailTasks().catch((err: unknown) => console.error(`[connections] ${emailProvider} wake failed`, err)));
          }
        }
      }
    } catch (err) {
      console.error("[connections] status refresh failed", err);
    }
  }

  const { data: rows } = await supabase
    .from("employee_connectors")
    .select("id, provider, status, created_at")
    .eq("employee_id", id)
    .order("created_at");

  return NextResponse.json({
    // Only the app grants belong in this panel; email, Slack and voice are the
    // profile's Channels section.
    connections: (rows ?? []).filter((row) => connectorSpec(row.provider).reach === "composio"),
    configured: hasEnv("COMPOSIO_API_KEY"),
  });
}

export async function POST(request: Request, { params }: Params) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isPrivileged(ctx.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  if (!hasEnv("COMPOSIO_API_KEY")) {
    return NextResponse.json({ error: "COMPOSIO_API_KEY is not configured" }, { status: 501 });
  }

  const { toolkit } = (await request.json()) as { toolkit?: string };
  const slug = toolkit?.trim().toLowerCase();
  if (!slug) return NextResponse.json({ error: "toolkit is required" }, { status: 400 });

  const supabase = await createClient();
  const { data: employee } = await supabase
    .from("employees")
    .select("id, org_id")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });

  const { data: enabled } = await createAdminClient()
    .from("org_connectors")
    .select("provider")
    .eq("org_id", employee.org_id)
    .eq("provider", COMPOSIO_PROVIDER)
    .eq("status", "active")
    .maybeSingle();
  if (!enabled) {
    return NextResponse.json({ error: "this org does not have Composio turned on" }, { status: 409 });
  }

  // Managed OAuth: the employee id is the Composio user, so this grant is
  // visible to exactly this employee's worker sessions
  // (docs/architecture.md, the scoping implementation note).
  const session = await composio().create(id, { manageConnections: false }, { signal: AbortSignal.timeout(30_000) }) as ComposioSession;
  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  const isLocal = origin.includes("localhost") || origin.includes("127.0.0.1");
  const callbackOrigin = isLocal ? origin : publicAppUrl(request);
  try {
    const connection = await session.authorize(slug, {
      // Returns to a terminal "close this tab" page, not the employee profile —
      // OAuth completes in a popup, and landing on the profile stranded the user
      // on a not-yet-hired employee mid-wizard (#94).
      callbackUrl: `${callbackOrigin}/employees/${id}/connected`,
    }, { signal: AbortSignal.timeout(30_000) });

    return NextResponse.json({ redirectUrl: connection.redirectUrl ?? null });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("does not manage auth") || message.includes("NoManagedAuth")) {
      return NextResponse.json(
        {
          error: `"${slug}" does not support 1-click Managed OAuth. It requires custom Google Cloud credentials configured on Composio.`,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isPrivileged(ctx.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const { toolkit } = (await request.json()) as { toolkit?: string };
  const slug = toolkit?.trim().toLowerCase();
  if (!slug) return NextResponse.json({ error: "toolkit is required" }, { status: 400 });
  // This endpoint revokes app grants only — a native connector is torn down by
  // firing the employee, and deleting its row here would strand the vendor
  // resource it names.
  if (connectorSpec(slug).reach !== "composio") {
    return NextResponse.json({ error: "not an app grant" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });

  const { data: connection, error: lookupError } = await createAdminClient()
    .from("employee_connectors")
    .select("credential")
    .eq("org_id", ctx.orgId)
    .eq("employee_id", id)
    .eq("provider", slug)
    .maybeSingle();
  if (lookupError) {
    return NextResponse.json({ error: "could not read the connection" }, { status: 500 });
  }
  if (!connection) return NextResponse.json({ error: "not connected" }, { status: 404 });

  if (hasEnv("COMPOSIO_API_KEY")) {
    try {
      const { composio_account_id } = connectorFields<ComposioCredential>(connection.credential);
      await revokeToolkit(id, slug, composio_account_id ?? null);
    } catch (err) {
      console.error(`[connections] revoke failed for employee ${id} toolkit ${slug}`, err);
      return NextResponse.json({ error: "could not disconnect — try again" }, { status: 503 });
    }
  }

  const { data: deleted, error } = await supabase
    .from("employee_connectors")
    .delete()
    .eq("employee_id", id)
    .eq("provider", slug)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: "could not remove the connection" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
