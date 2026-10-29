/**
 * Worker env access. Supabase and Anthropic are optional at boot so the process
 * still starts for a health check without keys; the turn path fails loud if a
 * key it needs is missing (spec conventions: fail loud, not silent).
 */

export const PORT = Number(process.env.PORT ?? 8080);

/**
 * Which Cloud Run service this process is — `ate-worker-prod` or
 * `ate-worker-dev`. K_SERVICE is injected by Cloud Run, so the health check
 * and boot log name the deployment that actually answered rather than a
 * hardcoded string that drifts when services are renamed.
 */
export const serviceName = () => process.env.K_SERVICE ?? "ate-worker (local)";

export function isNimConfigured(): boolean {
  return Boolean(process.env.NVIDIA_API_KEY || process.env.NIM_API_KEY);
}

export function nimApiKey(): string {
  const key = process.env.NVIDIA_API_KEY || process.env.NIM_API_KEY;
  if (!key) throw new Error("Missing NVIDIA_API_KEY or NIM_API_KEY.");
  return key;
}

export function anthropicApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY (or set NVIDIA_API_KEY for NVIDIA NIM).");
  return key;
}

/**
 * Optional shared secret. When set, POST /turn requires a matching
 * `x-worker-secret` header — required in deployed environments where the
 * worker URL is public (Cloud Run); unset for local dev.
 */
export const sharedSecret = () => process.env.WORKER_SHARED_SECRET || null;

/** Present only when the worker is wired to Supabase. */
export function supabaseConfig(): { url: string; serviceRoleKey: string } | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}
