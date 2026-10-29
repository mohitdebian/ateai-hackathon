import * as Sentry from "@sentry/node";
import { createAdminClient, logDegraded } from "./supabase.js";
import { runTurn } from "./turn.js";

/**
 * Heartbeat: one scheduled trigger fans out a follow-up turn to every
 * hired employee. Cloud Scheduler calls POST /heartbeat on an interval; the
 * turn runs on the normal path, so it shares memory, knowledge, tools, and the
 * event log — the activity rail shows employees "checking in".
 */

const DEFAULT_PROMPT =
  "Heartbeat check-in. Review your recent conversation and memory: if you committed to " +
  "follow up on something that is now due, do it (use your tools if you have them). " +
  "Otherwise reply in one or two sentences with what you're monitoring.";

const MORNING_PROMPT =
  "Morning check-in. Execute any daily responsibilities that are recurring deliverables " +
  "(and weekly ones if today is their day). If you lack the connected apps or data to complete one, " +
  "tell your manager once what you need connected rather than sending an empty or made-up report. " +
  "Afterward, review your memory: if you committed to follow up on something that is now due, do it. " +
  "Otherwise reply in one or two sentences with what you're monitoring.";
export interface HeartbeatResult {
  employees: number;
  ok: number;
  failed: number;
}

/** Run one heartbeat sweep. Sequential on purpose — no thundering herd. */
export async function runHeartbeat(): Promise<HeartbeatResult> {
  const admin = createAdminClient();

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const cleanup = await Promise.all([
    admin.from("webhook_events").delete().lt("created_at", cutoff),
    admin.from("rate_limits").delete().lt("window_start", cutoff),
    admin.from("email_tasks").delete().in("status", ["ignored", "done"])
      .lt("updated_at", cutoff),
  ]);
  for (const { error } of cleanup) {
    if (error && error.code !== "PGRST205") {
      console.error(`[heartbeat] retention cleanup failed: ${error.message}`);
      Sentry.captureException(error);
    }
  }

  const { data: employees, error } = await admin
    .from("employees")
    .select("id, org_id, name")
    .not("hired_at", "is", null);
  if (error) throw new Error(`heartbeat: employees query failed: ${error.message}`);

  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(new Date()),
    10,
  );
  const basePrompt = hour === 9 ? MORNING_PROMPT : DEFAULT_PROMPT;
  const prompt = process.env.HEARTBEAT_PROMPT || basePrompt;
  let ok = 0;
  let failed = 0;
  for (const employee of employees ?? []) {
    const envelope = {
      org_id: employee.org_id,
      employee_id: employee.id,
      channel: "heartbeat" as const,
      text: prompt,
    };
    try {
      await runTurn(envelope);
      ok++;
    } catch (err) {
      failed++;
      console.error(`[heartbeat] turn failed for ${employee.name} (${employee.id})`);
      // Nobody to reply to, but the failure still belongs on the activity rail (#118).
      await logDegraded(envelope, "heartbeat", err);
    }
  }
  return { employees: employees?.length ?? 0, ok, failed };
}
