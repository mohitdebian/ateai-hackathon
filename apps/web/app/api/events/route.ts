import { NextResponse } from "next/server";
import { getOrgContext } from "../../../lib/auth";
import { createClient } from "../../../lib/supabase/server";

export const runtime = "nodejs";

/**
 * Recent org activity for the dashboard activity rail (docs/product.md "Design vision"). Polled by the
 * rail for a near-real-time stream. RLS scopes reads to the caller's org.
 */
export async function GET(request: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 40);
  const supabase = await createClient();

  const [{ data: events }, { data: employees }] = await Promise.all([
    supabase
      .from("events")
      .select("id, employee_id, channel, kind, payload, created_at")
      .order("created_at", { ascending: false })
      .limit(Math.min(limit, 100)),
    supabase.from("employees").select("id, name"),
  ]);

  const names = new Map((employees ?? []).map((e) => [e.id, e.name]));
  const feed = (events ?? []).map((e) => ({
    id: e.id,
    employee_id: e.employee_id,
    employee_name: e.employee_id ? (names.get(e.employee_id) ?? "Unknown") : "System",
    channel: e.channel,
    kind: e.kind,
    payload: e.payload,
    created_at: e.created_at,
  }));

  return NextResponse.json({ events: feed });
}
