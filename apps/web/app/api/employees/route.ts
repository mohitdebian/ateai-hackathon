import { NextResponse, after } from "next/server";
import type { IdentityFile } from "@ate/shared";
import { createMemoryClient } from "@ate/shared";
import { getOrgContext } from "../../../lib/auth";
import { createAdminClient, createClient } from "../../../lib/supabase/server";

export const runtime = "nodejs";

interface TranscriptTurn {
  role: string;
  text: string;
}

const MAX_INTERVIEW_TURNS = 200;
const MAX_INTERVIEW_CHARS = 20_000;

function sanitizeInterview(value: unknown): TranscriptTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: TranscriptTurn[] = [];
  let chars = 0;
  for (const t of value) {
    if (turns.length >= MAX_INTERVIEW_TURNS || chars >= MAX_INTERVIEW_CHARS) break;
    const turn = t as Partial<TranscriptTurn>;
    let text = String(turn?.text ?? "").trim();
    if (!text) continue;
    text = text.slice(0, MAX_INTERVIEW_CHARS - chars);
    turns.push({ role: String(turn?.role ?? ""), text });
    chars += text.length;
  }
  return turns;
}

/**
 * Configure step (docs/product.md "Vision"). Creates the employee row from the edited
 * soul file (`employees.identity`) as an unhired draft (`hired_at` null). Hiring is one
 * continuous run, so the wizard keeps this id and continues train → grant access → hire
 * against it. The manager defaults to the creator (a human platform user), per the
 * manager rule (docs/product.md "Vision").
 */
export async function POST(request: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { interview, ...identity } = (await request.json()) as Partial<IdentityFile> & {
    interview?: unknown;
  };
  if (!identity.name || identity.name.trim().length === 0) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Only a human can manage (#201) — always the creator, never client-supplied.
  const manager = { id: ctx.userId };

  // Direct reports start empty.
  const fullIdentity: IdentityFile = {
    name: identity.name,
    avatar: identity.avatar ?? "",
    role: identity.role ?? "",
    persona: identity.persona ?? "",
    scope_of_work: identity.scope_of_work ?? "",
    daily_responsibilities: identity.daily_responsibilities ?? [],
    manager,
    operating_rules: identity.operating_rules ?? [],
    email_address: identity.email_address ?? "",
    slack_handle: identity.slack_handle ?? "",
  };

  const { data, error } = await supabase
    .from("employees")
    .insert({
      org_id: ctx.orgId,
      name: fullIdentity.name,
      manager_id: fullIdentity.manager.id,
      identity: fullIdentity,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "could not create employee" },
      { status: 400 },
    );
  }

  const turns = sanitizeInterview(interview);
  if (turns.length > 0) {
    const employeeId = data.id;
    const transcript = turns
      .map((t) => `${t.role === "assistant" ? "you" : "manager"}: ${t.text}`)
      .join("\n");
    after(async () => {
      // Memory so the employee can recall the interview, an event so the manager
      // can read it back in the activity rail — the two halves the Vapi webhook
      // gets for free by running a turn, which an unhired draft can't do (#143).
      try {
        await createMemoryClient(process.env.MEM0_API_KEY).write(
          ctx.orgId,
          employeeId,
          turns.map((t) => ({
            role: t.role === "assistant" ? "assistant" : "user",
            content: t.text,
          })),
        );
      } catch (err) {
        console.error("[employees] interview memory write failed", err);
      }
      // Service role: `events` grants members read only (migration 0001).
      try {
        const { error: eventError } = await createAdminClient()
          .from("events")
          .insert({
            org_id: ctx.orgId,
            employee_id: employeeId,
            channel: "voice",
            kind: "message",
            payload: { direction: "inbound", text: `**Hiring interview**\n\n${transcript}` },
          });
        if (eventError) throw new Error(eventError.message);
      } catch (err) {
        console.error("[employees] interview event write failed", err);
      }
    });
  }

  return NextResponse.json({ id: data.id });
}
