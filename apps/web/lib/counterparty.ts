import type { Counterparty } from "@ate/shared";
import { createAdminClient } from "./supabase/server";

/**
 * Resolve who an inbound message is from (#43), so the employee knows whether
 * it is talking to its manager or to an outsider.
 *
 * Demo MVP recognises exactly one internal identity: the employee's own
 * manager. Everyone else is external — there is no customers table and no team
 * concept to distinguish "colleague" from "stranger", so inventing one would
 * be a guess the employee then acts on.
 *
 * Email matches on the `From` address alone (#149). AgentMail exposes no
 * SPF/DKIM/DMARC result to check it against, so this is a basic match rather
 * than proof of who sent it — deliberately, because the alternative it replaces
 * (every email is external, forever) meant a manager writing to its own
 * employee was a stranger to it.
 * ponytail: tighten to real sender verification if AgentMail ever exposes an
 * Authentication-Results signal.
 */

/** Pull the bare address out of `"Name <a@b.com>"`, or pass a bare one through. */
export function parseEmailAddress(from: string): string {
  const angled = from.match(/<([^>]+)>/);
  return (angled ? angled[1] : from).trim().toLowerCase();
}

/**
 * The manager's own address + display name, or null when it can't be resolved.
 * The worker resolves the same way in apps/worker/src/outbound.ts (#215) —
 * change both together.
 */
async function managerContact(
  employeeId: string,
): Promise<{ address: string; name: string } | null> {
  const admin = createAdminClient();
  const { data: employee } = await admin
    .from("employees")
    .select("manager_id")
    .eq("id", employeeId)
    .maybeSingle();
  if (!employee?.manager_id) return null;

  const { data: mgr } = await admin
    .from("users")
    .select("name, email")
    .eq("id", employee.manager_id)
    .maybeSingle();
  if (!mgr?.email) return null;
  return { address: mgr.email.toLowerCase(), name: mgr.name ?? mgr.email };
}

/** Pull the display name out of `"Name <a@b.com>"`, or null when there isn't one. */
export function parseDisplayName(from: string): string | null {
  if (!from.includes("<")) return null;
  const name = from.slice(0, from.indexOf("<")).trim().replace(/^"|"$/g, "").trim();
  return name || null;
}

export async function resolveByEmail(
  employeeId: string,
  fromHeader: string,
): Promise<Counterparty> {
  const address = parseEmailAddress(fromHeader);
  const name = parseDisplayName(fromHeader);
  const manager = await managerContact(employeeId);
  if (manager && manager.address === address) {
    return { kind: "manager", name: name ?? manager.name, address };
  }
  return { kind: "external", ...(name ? { name } : {}), address };
}

/**
 * Classify a Slack sender. Slack gives a user id with no local mapping, so the
 * employee's own bot token looks the person up and their email is compared.
 *
 * Requires `users:read` + `users:read.email` on the app. Those scopes only
 * apply to apps created after they were added to the manifest, so an employee
 * hired earlier gets `missing_scope` here — that degrades to `external` and
 * logs, the same way turn.ts degrades recall/knowledge failures. It never
 * sinks the turn.
 */
export async function resolveBySlackUser(
  employeeId: string,
  slackUserId: string,
  botToken: string | null,
): Promise<Counterparty> {
  if (!botToken || !slackUserId) return { kind: "external", address: slackUserId };

  try {
    const res = await fetch(
      `https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`,
      { headers: { authorization: `Bearer ${botToken}` }, signal: AbortSignal.timeout(30_000) },
    );
    const body = (await res.json()) as {
      ok: boolean;
      error?: string;
      user?: { real_name?: string; profile?: { email?: string; real_name?: string } };
    };
    if (!body.ok || !body.user) {
      console.error(`[counterparty] slack users.info failed: ${body.error ?? "unknown"}`);
      return { kind: "external", address: slackUserId };
    }

    const email = body.user.profile?.email;
    const name = body.user.real_name ?? body.user.profile?.real_name;
    if (!email) return { kind: "external", name, address: slackUserId };

    const manager = await managerContact(employeeId);
    if (manager && manager.address === email.toLowerCase()) {
      return { kind: "manager", name: name ?? manager.name, address: email };
    }
    return { kind: "external", name, address: email };
  } catch (err) {
    console.error("[counterparty] slack lookup failed", err);
    return { kind: "external", address: slackUserId };
  }
}

/** Is this signed-in platform user the employee's manager? Used by the dashboard call. */
export async function isManagerOf(employeeId: string, userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("employees")
    .select("manager_id")
    .eq("id", employeeId)
    .maybeSingle();
  return data?.manager_id === userId;
}
