/**
 * Central env access. Read through these helpers so a missing key fails loud at
 * the call site (spec conventions: fail loud, not silent) instead of surfacing
 * as a confusing runtime error deep in a vendor SDK.
 *
 * IMPORTANT: `NEXT_PUBLIC_*` vars must be referenced as STATIC
 * `process.env.NEXT_PUBLIC_FOO` member accesses — Next only inlines them into
 * the client bundle when it can see them literally. A dynamic `process.env[name]`
 * lookup is left as `undefined` in the browser.
 */

function must(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required env var: ${name}. See apps/web/.env.example.`);
  }
  return value;
}

// Public (browser-safe) Supabase config — static references so Next inlines them.
export const supabaseUrl = () =>
  must("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
export const supabaseAnonKey = () =>
  must("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
export const vapiPublicKey = () =>
  must("NEXT_PUBLIC_VAPI_PUBLIC_KEY", process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY);

// Server-only. Never imported into a client component.
export const supabaseServiceRoleKey = () =>
  must("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
export const isNimConfigured = () => Boolean(process.env.NVIDIA_API_KEY || process.env.NIM_API_KEY);
export const nimApiKey = () =>
  process.env.NVIDIA_API_KEY || process.env.NIM_API_KEY || must("NVIDIA_API_KEY", undefined);
export const anthropicApiKey = () =>
  must("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY);
export const voyageApiKey = () => must("VOYAGE_API_KEY", process.env.VOYAGE_API_KEY);

// The worker's base URL; webhooks dispatch turns to it.
export const workerUrl = () => must("WORKER_URL", process.env.WORKER_URL);
// Optional; must match WORKER_SHARED_SECRET on the worker when it is deployed.
export const workerSharedSecret = () => process.env.WORKER_SHARED_SECRET;

/** Public origin vendors use for OAuth redirects and webhooks. */
export function publicAppUrl(request: Request): string {
  return process.env.PUBLIC_APP_URL
    ? new URL(process.env.PUBLIC_APP_URL).origin
    : new URL(request.url).origin;
}

// Vendor keys for grant-access + provisioning. Fail loud at the
// call site; the hire flow treats a missing key as "step skipped", not "throw".
export const composioApiKey = () => must("COMPOSIO_API_KEY", process.env.COMPOSIO_API_KEY);
export const agentmailApiKey = () => must("AGENTMAIL_API_KEY", process.env.AGENTMAIL_API_KEY);
export const agentmailWebhookSecret = () =>
  must("AGENTMAIL_WEBHOOK_SECRET", process.env.AGENTMAIL_WEBHOOK_SECRET);
export const vapiApiKey = () => must("VAPI_API_KEY", process.env.VAPI_API_KEY);
export const vapiWebhookSecret = () =>
  must("VAPI_WEBHOOK_SECRET", process.env.VAPI_WEBHOOK_SECRET);

/** Is a vendor configured? Provisioning steps skip (visibly) when not. */
export const hasEnv = (name: "COMPOSIO_API_KEY" | "AGENTMAIL_API_KEY" | "VAPI_API_KEY") =>
  Boolean(process.env[name]);
