import { NextResponse, after } from "next/server";
import type { SlackConfig, SlackCredential } from "@ate/shared";
import { connectorFields } from "@ate/shared";
import { createAdminClient } from "../../../../lib/supabase/server";
import { exchangeInstallCode } from "../../../../lib/channels/slack";
import { publicAppUrl } from "../../../../lib/env";
import { dispatchEmailTasks } from "../../../../lib/worker";

export const runtime = "nodejs";

/**
 * OAuth callback for installing an employee's Slack app (docs/architecture.md "Slack").
 * Slack redirects here after the admin clicks "Install to Slack" and approves;
 * we exchange the code for the bot token, store it on the employee's Slack
 * connector, and land back on the profile. No session on this request (it comes
 * from Slack), so it authenticates by the state param: a single-use random
 * nonce the hire route stored in `config.install_state`, only honored while the
 * connector has no bot token yet (#33). The nonce is cleared after a
 * successful exchange, and the exchange itself requires the app's
 * client_secret.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const appUrl = publicAppUrl(request);

  const back = (employeeId?: string, msg?: string) =>
    NextResponse.redirect(
      employeeId
        ? `${appUrl}/employees/${employeeId}${msg ? `?slack_error=${encodeURIComponent(msg)}` : ""}`
        : `${appUrl}/dashboard${msg ? `?slack_error=${encodeURIComponent(msg)}` : ""}`,
    );

  if (error) return back(undefined, error);
  if (!code || !state) return back(undefined, "missing code or state");

  const admin = createAdminClient();
  const { data: connector } = await admin
    .from("employee_connectors")
    .select("id, employee_id, credential, config")
    .eq("provider", "slack")
    .eq("config->>install_state", state)
    .maybeSingle();
  const credential = connectorFields<SlackCredential>(connector?.credential);
  const config = connectorFields<SlackConfig>(connector?.config);
  if (!connector || credential.bot_token || !config.client_id || !credential.client_secret) {
    return back(undefined, "no slack app pending install for this state");
  }

  try {
    const { bot_token, bot_user_id } = await exchangeInstallCode(
      config.client_id,
      credential.client_secret,
      code,
      `${appUrl}/api/slack/oauth`,
    );
    // One write: the token, the bot id the profile's DM link needs, and the
    // spent nonce dropped so a replay of this callback finds nothing.
    const nextConfig = { ...config, bot_id: bot_user_id };
    delete nextConfig.install_state;
    const { error: storeError } = await admin
      .from("employee_connectors")
      .update({
        credential: { ...credential, bot_token },
        config: nextConfig,
        status: "active",
      })
      .eq("id", connector.id);
    if (storeError) throw storeError;
    after(() => dispatchEmailTasks().catch((err: unknown) => console.error("[slack oauth] Outlook wake failed", err)));
    return back(connector.employee_id);
  } catch (err) {
    console.error("[slack oauth] exchange failed", err);
    return back(connector.employee_id, err instanceof Error ? err.message : "install failed");
  }
}
