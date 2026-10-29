import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/node";
import type { Database, Envelope, EventInput, EventLogger } from "@ate/shared";
import { supabaseConfig } from "./env.js";

/** Service-role Supabase client (bypasses RLS). Required to run a turn. */
export function createAdminClient(): SupabaseClient<Database> {
  const cfg = supabaseConfig();
  if (!cfg) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (needed to run a turn).");
  return createClient<Database>(cfg.url, cfg.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }) },
  });
}

/**
 * EventLogger backed by the `events` table (docs/data-model.md). The worker writes with the
 * service role, so it scopes every row by the org_id/employee_id it was given.
 */
export function createEventLogger(client: SupabaseClient<Database>): EventLogger {
  return {
    async append(event: EventInput) {
      let { error } = await client.from("events").insert({
        org_id: event.org_id,
        employee_id: event.employee_id,
        channel: event.channel,
        kind: event.kind,
        payload: event.payload,
      });

      // If 'web' violates check constraint before DB migration is applied, fallback to 'email' with actual_channel
      if (error && event.channel === "web" && error.code === "23514") {
        const payload =
          event.payload && typeof event.payload === "object"
            ? { ...(event.payload as Record<string, unknown>), actual_channel: "web" }
            : event.payload;
        const fallback = await client.from("events").insert({
          org_id: event.org_id,
          employee_id: event.employee_id,
          channel: "email",
          kind: event.kind,
          payload,
        });
        error = fallback.error;
      }

      if (error) throw new Error(`events.insert failed: ${error.message}`);
    },
  };
}

/** What went wrong in a turn that the turn survived (or that the sender was told about). */
export type DegradedSource =
  | "recall"
  | "knowledge"
  | "documents"
  | "recent"
  | "connectors"
  | "tools"
  | "tool_cap"
  | "output_cap"
  | "delivery"
  | "heartbeat";

/** Append a message event for the envelope's employee; `payload` may override `direction`. */
async function logMessage(
  envelope: Envelope,
  payload: Record<string, unknown>,
  onFail: (err: unknown) => void,
): Promise<void> {
  try {
    await createEventLogger(createAdminClient()).append({
      org_id: envelope.org_id,
      employee_id: envelope.employee_id,
      channel: envelope.channel,
      kind: "message",
      payload: { direction: "system", ...payload },
    });
  } catch (logErr: unknown) {
    onFail(logErr);
  }
}

/**
 * Record a degradation as a `system` message event, so it shows on the
 * activity rail and profile page instead of only in the Cloud Run logs
 * (#118). Never throws, including on `createAdminClient` — the caller is
 * already on a failure path. `text` is what the sender was actually shown.
 */
export async function logDegraded(
  envelope: Envelope,
  source: DegradedSource,
  err: unknown,
  text?: string,
): Promise<void> {
  console.error(`[turn] ${source} failed`, err);
  Sentry.captureException(err);
  const error = err instanceof Error ? err.message : String(err);
  await logMessage(
    envelope,
    { degraded: source, error, text: text ?? (err instanceof Error && err.name === "TimeoutError" ? "A service took too long to respond." : `${source} failed: ${error}`) },
    (logErr) => {
      console.error(`[turn] failed to log ${source} degradation`, logErr);
      Sentry.captureException(logErr);
    },
  );
}

/**
 * Record the "still working on it" notice sent mid-turn (#124). Logged as
 * `outbound` — the sender really was sent it — with `notice` marking it as the
 * interim line rather than the turn's reply.
 */
export async function logNotice(envelope: Envelope, text: string): Promise<void> {
  await logMessage(envelope, { direction: "outbound", notice: true, text }, (logErr) =>
    console.error("[turn] failed to log notice", logErr),
  );
}
