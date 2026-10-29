import type { IdentityFile } from "@ate/shared";
import { vapiApiKey, vapiPublicKey, vapiWebhookSecret } from "../env";
import { vendorError } from "../retry";

/**
 * Vapi voice channel, provisioning side. Calls run on Vapi's own Anthropic
 * LLM; the real system prompt (identity + memory + knowledge + recent
 * conversation, assembled by the worker's /context) is injected per call via
 * assistantOverrides (#119), so it is never frozen at hire. One transcript
 * turn runs when the end-of-call report lands on /api/webhooks/vapi.
 */

const BASE = "https://api.vapi.ai";

// Anthropic model id Vapi runs the calls on. Overridable because Vapi
// validates against its own allowlist, which moves over time — if creation
// 400s on this, set VAPI_MODEL to a model shown in Vapi's dashboard.
const model = () => process.env.VAPI_MODEL || "claude-sonnet-4-5-20250929";

// Area code to prefer. Vapi rejects a create without one ("At least one of
// numberDesiredAreaCode, sipUri must be provided"), but its free pool covers
// only a handful of codes at any moment, so this is a wish rather than a
// setting — `provisionPhoneNumber` falls back to whatever Vapi says it has.
const areaCode = () => process.env.VAPI_AREA_CODE || "972";

const anthropicModel = (system: string) => ({
  provider: "anthropic" as const,
  model: model(),
  messages: [{ role: "system" as const, content: system }],
});

/**
 * The bundle every call injects: the freshly assembled prompt plus the caller
 * variables Vapi echoes back on the end-of-call report. Both call paths build
 * it here — the web call at creation, the phone call when Vapi asks who should
 * answer (#252) — so the two cannot drift into different-sounding employees.
 */
export function voiceOverrides(system?: string, variableValues: Record<string, string> = {}) {
  return {
    ...(system ? { model: anthropicModel(system) } : {}),
    ...(Object.keys(variableValues).length > 0 ? { variableValues } : {}),
  };
}

// Spoken only if a call is somehow created without the per-call override.
export function fallbackPrompt(name: string, identity: IdentityFile): string {
  return (
    `You are ${identity.name || name}, an AI employee, on a live voice call with a ` +
    `colleague inside your company. Persona: ${identity.persona || "professional"}. ` +
    `Role: ${identity.role || "AI employee"}. Scope: ${identity.scope_of_work || "help the caller"}. ` +
    `Operating rules: ${(identity.operating_rules ?? []).join("; ") || "be helpful and honest"}. ` +
    `Speak naturally and keep answers short. You cannot take actions or look anything up ` +
    `during the call — say you'll do it right after the call instead.`
  );
}

export async function createVapiAssistant(
  name: string,
  identity: IdentityFile,
  webhookUrl: string,
): Promise<string> {
  const res = await fetch(`${BASE}/assistant`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${vapiApiKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name,
      model: anthropicModel(fallbackPrompt(name, identity)),
      firstMessage: `Hi, this is ${identity.name || name}. What can I do for you?`,
      server: {
        url: webhookUrl,
        headers: { "x-webhook-secret": vapiWebhookSecret() },
      },
      serverMessages: ["end-of-call-report"],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw vendorError("vapi create assistant", res, body);
  }
  const assistant = (await res.json()) as { id: string };
  return assistant.id;
}

/**
 * Point an existing assistant back at Vapi's Anthropic LLM. One-off backfill
 * for assistants created while voice ran as a custom LLM (#138); idempotent.
 */
export async function updateVapiAssistant(
  assistantId: string,
  name: string,
  identity: IdentityFile,
): Promise<void> {
  const res = await fetch(`${BASE}/assistant/${assistantId}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${vapiApiKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: anthropicModel(fallbackPrompt(name, identity)), credentialIds: [] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`vapi update assistant ${res.status}: ${body}`);
  }
}

/** Delete an employee's assistant at teardown. A 404 means it's already gone. */
export async function deleteAssistant(assistantId: string): Promise<void> {
  const res = await fetch(`${BASE}/assistant/${assistantId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${vapiApiKey()}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(`vapi delete assistant ${res.status}: ${body}`);
  }
}

/**
 * Create a web call server-side (#43) so the injected prompt and the
 * `caller_*` variables come from the authenticated request, not from
 * the browser. The client only ever receives the resulting join URL — it
 * can't set or override what decides whether the assistant treats the caller
 * as its manager. `variableValues` are echoed back on the end-of-call report,
 * which is how the transcript turn learns who the call was with.
 */
export interface VapiWebCall {
  webCallUrl: string;
  id?: string;
  artifactPlan?: { videoRecordingEnabled?: boolean };
  assistant?: { voice?: { provider?: string } };
}

export async function createVapiWebCall(
  assistantId: string,
  system?: string,
  variableValues: Record<string, string> = {},
): Promise<VapiWebCall> {
  // /call/web, not /call: the generic endpoint creates an *outbound phone* call
  // and 400s asking for a phone number ("Couldn't Get Phone Number"). This is
  // the endpoint the browser SDK's vapi.start() uses internally, and like the
  // SDK it authenticates with the public key — the private key 401s here (#96).
  const overrides = voiceOverrides(system, variableValues);
  const res = await fetch(`${BASE}/call/web`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${vapiPublicKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      assistantId,
      ...(Object.keys(overrides).length > 0 ? { assistantOverrides: overrides } : {}),
      // Keep the room alive when the tab leaves so the join below (and any
      // reconnect) is allowed — it defaults to true, which deletes the room.
      roomDeleteOnUserLeaveEnabled: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`vapi create call ${res.status}: ${body}`);
  }
  const call = (await res.json()) as VapiWebCall & {
    webCallUrl?: string;
    transport?: { callUrl?: string };
  };
  const webCallUrl = call.webCallUrl ?? call.transport?.callUrl;
  if (!webCallUrl) throw new Error("vapi create call: no webCallUrl in response");
  // The browser hands this straight to vapi.reconnect(), which reads the
  // artifact plan and voice provider — dropping them degrades video handling.
  return { webCallUrl, id: call.id, artifactPlan: call.artifactPlan, assistant: call.assistant };
}

/**
 * Buy a Vapi-provisioned number and point it at our webhook (#252).
 *
 * Deliberately created with no `assistantId`: a number that names its assistant
 * is answered by the assistant as stored, which is `fallbackPrompt` above — no
 * memory, no knowledge, and a greeting that calls a stranger a colleague. With
 * the field absent Vapi instead asks `/api/webhooks/vapi` who should answer,
 * which is where the real prompt gets injected.
 *
 * Free Vapi numbers are US-only, inbound-only, and capped at 5 per account.
 */
export async function provisionPhoneNumber(
  name: string,
  webhookUrl: string,
  assistantId?: string | null,
): Promise<{ id: string; number: string; status: string }> {
  const tried = new Set<string>();
  const queue = [areaCode()];

  while (queue.length > 0) {
    const code = queue.shift() as string;
    if (tried.has(code)) continue;
    tried.add(code);

    const res = await fetch(`${BASE}/phone-number`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${vapiApiKey()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        provider: "vapi",
        name,
        numberDesiredAreaCode: code,
        ...(assistantId ? { assistantId } : {}),
        server: {
          url: webhookUrl,
          headers: { "x-webhook-secret": vapiWebhookSecret() },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (res.ok) {
      const created = (await res.json()) as { id?: string; number?: string; status?: string };
      if (!created.id || !created.number) {
        throw new Error("vapi create phone number: no id or number in response");
      }
      // A fresh number comes back "activating" and the carrier rejects calls to
      // it until it is "active" — a minute or two later, with no callback.
      return { id: created.id, number: created.number, status: created.status ?? "activating" };
    }

    // Which codes have free numbers changes without notice, so a preferred one
    // is a wish. Vapi names what it does have on the way out; take it rather
    // than making a human guess again.
    const body = await res.text().catch(() => "");
    const suggested = suggestedAreaCodes(body).filter((c) => !tried.has(c));
    if (suggested.length === 0) throw vendorError("vapi create phone number", res, body);
    queue.push(...suggested);
  }

  throw new Error("vapi create phone number: no area code had a free number");
}

/**
 * The area codes out of a Vapi rejection: "This area code is currently not
 * available. Hint: Try one of 859, 912, 708."
 */
export function suggestedAreaCodes(body: string): string[] {
  const hint = /Try one of ([\d,\s]+)/.exec(body);
  return hint ? (hint[1].match(/\d{3}/g) ?? []) : [];
}

/** Release a number at teardown. A 404 means it's already gone. */
export async function releasePhoneNumber(phoneNumberId: string): Promise<void> {
  const res = await fetch(`${BASE}/phone-number/${phoneNumberId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${vapiApiKey()}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(`vapi delete phone number ${res.status}: ${body}`);
  }
}

/**
 * Where a number is in Vapi's activation. There is no webhook for this, so the
 * only way to learn a number went live is to ask.
 */
export async function phoneNumberStatus(phoneNumberId: string): Promise<string | null> {
  const res = await fetch(`${BASE}/phone-number/${phoneNumberId}`, {
    headers: { authorization: `Bearer ${vapiApiKey()}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  const number = (await res.json()) as { status?: string };
  return number.status ?? null;
}
