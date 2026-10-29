import { NextResponse } from "next/server";
import { getOrgContext } from "../../../../../lib/auth";
import { createClient } from "../../../../../lib/supabase/server";
import { runWebTurn } from "../../../../../lib/worker";

export const runtime = "nodejs";

/**
 * GET /api/employees/[id]/chat
 * Returns previous conversation messages between the user and employee on the web channel.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const supabase = await createClient();
  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });

  const { data: events, error } = await supabase
    .from("events")
    .select("id, created_at, kind, payload")
    .eq("org_id", ctx.orgId)
    .eq("employee_id", id)
    .eq("kind", "message")
    .or("channel.eq.web,payload->>actual_channel.eq.web")
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const messages = (events ?? [])
    .map((e) => {
      const p = e.payload as { direction?: string; text?: string; counterparty?: { name?: string } };
      return {
        id: e.id,
        createdAt: e.created_at,
        direction: (p.direction === "outbound" ? "outbound" : "inbound") as "inbound" | "outbound",
        text: typeof p.text === "string" ? p.text : "",
        sender: p.direction === "inbound" ? (p.counterparty?.name ?? ctx.name ?? "You") : "assistant",
      };
    })
    .filter((m) => m.text.length > 0);

  return NextResponse.json({ messages });
}

/**
 * POST /api/employees/[id]/chat
 * Sends a message in the direct web chat and returns the employee's reply synchronously.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const text = (body as { message?: string })?.message?.trim();
  if (!text) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: employee } = await supabase
    .from("employees")
    .select("id, name, identity")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });
  if (employee.identity?.paused) {
    return NextResponse.json(
      { error: `${employee.name} is paused. Resume to send messages.` },
      { status: 409 },
    );
  }

  // The dashboard chatbox is exclusively accessible to authenticated managers/admins managing the employee.
  // Treat as manager so the AI always recognizes its manager and their email address.
  const callerName = ctx.name ?? (ctx.email ? ctx.email.split("@")[0] : "Manager");
  const callerKind = "manager" as const;
  const callerAddress = ctx.email ? ctx.email.toLowerCase() : undefined;

  try {
    const { reply } = await runWebTurn(ctx.orgId, employee.id, text, {
      kind: callerKind,
      name: callerName,
      ...(callerAddress ? { address: callerAddress } : {}),
    });

    return NextResponse.json({
      reply,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[web-chat] turn failed", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `chat turn failed — ${detail}` }, { status: 502 });
  }
}
