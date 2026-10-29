/**
 * Humanize a tool event's payload for the activity surfaces (#45).
 * Tool events (apps/worker/src/turn.ts) carry { tool: <Composio slug>, input,
 * successful, error, duration_ms } and no text, e.g.
 * "GMAIL_SEND_EMAIL" — render "Gmail — send email" instead of the raw slug or
 * the old "(tool)" fallback, and append the outcome when it failed (#120).
 */
export function formatToolEvent(
  payload: { tool?: string; successful?: boolean; error?: string | null } | null | undefined,
): string {
  const slug = payload?.tool;
  if (!slug) return "Used a tool";
  const [app, ...action] = slug.split("_").filter(Boolean);
  if (!app) return "Used a tool";
  const appName = app.charAt(0) + app.slice(1).toLowerCase();
  const label = action.length === 0 ? appName : `${appName} — ${action.join(" ").toLowerCase()}`;
  if (payload?.successful === false) {
    return `${label} — failed${payload.error ? `: ${payload.error}` : ""}`;
  }
  return label;
}
