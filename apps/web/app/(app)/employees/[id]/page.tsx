import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { IdentityFile, SlackConfig } from "@ate/shared";
import { connectorFields, createMemoryClient } from "@ate/shared";
import { requireOrgContext } from "../../../../lib/auth";
import { createAdminClient, createClient } from "../../../../lib/supabase/server";
import { installUrl } from "../../../../lib/channels/slack";
import { createVapiAssistant } from "../../../../lib/channels/vapi";
import { ProfileHeader } from "./profile-header";
import { ChatPanel } from "./chat-panel";
import { ExecutionHistory } from "./execution-history";
import { ChannelsCard } from "./channels-card";
import { AccessPanel } from "./access-panel";
import type { MemoryItem } from "./memory-panel";
import { MemoryPanel } from "./memory-panel";
import { FireButton } from "./fire-button";
import { Card } from "@ate/design/components/Card";

export default async function EmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { orgId } = await requireOrgContext();
  const { id } = await params;

  const supabase = await createClient();
  const admin = createAdminClient();
  const [{ data: employee }, { data: connectors }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, name, hired_at, identity, manager_id")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("employee_connectors")
      .select("provider, address, config, status")
      .eq("employee_id", id),
  ]);
  if (!employee) notFound();

  const identity = employee.identity;

  const connector = (provider: string) =>
    (connectors ?? []).find((c) => c.provider === provider);
  const emailAddress = connector("agentmail")?.address ?? null;
  let assistantId = connector("vapi")?.address ?? null;

  if (!assistantId && process.env.VAPI_API_KEY) {
    try {
      const h = await headers();
      const proto = h.get("x-forwarded-proto") ?? "https";
      const host = h.get("host");
      const appUrl = host ? `${proto}://${host}` : "";
      if (appUrl) {
        assistantId = await createVapiAssistant(
          employee.name,
          (employee.identity as IdentityFile) ?? {},
          `${appUrl}/api/webhooks/vapi`,
        );
        await admin.from("employee_connectors").upsert({
          org_id: orgId,
          employee_id: employee.id,
          provider: "vapi",
          address: assistantId,
          status: "active",
        });
      }
    } catch (e) {
      console.warn("[vapi] could not auto-provision assistant on profile load:", e);
    }
  }

  const phone = connector("vapi_phone");
  const slack = connectorFields<SlackConfig>(connector("slack")?.config);

  const slackDmUrl = slack.bot_id
    ? `https://slack.com/app_redirect?channel=${slack.bot_id}`
    : null;
  let slackInstallUrl: string | null = null;
  if (!slackDmUrl && slack.client_id && slack.install_state) {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "http";
    const host = h.get("host");
    if (host) {
      slackInstallUrl = installUrl(
        slack.client_id,
        slack.install_state,
        `${proto}://${host}`,
      );
    }
  }

  const { data: phoneConnector } = await createAdminClient()
    .from("org_connectors")
    .select("provider")
    .eq("org_id", orgId)
    .eq("provider", "vapi_phone")
    .eq("status", "active")
    .maybeSingle();

  const mem0Key = process.env.MEM0_API_KEY;

  const [managerName, memories] = await Promise.all([
    (async (): Promise<string | null> => {
      if (!employee.manager_id) return null;
      const { data: manager } = await supabase
        .from("users")
        .select("name")
        .eq("id", employee.manager_id)
        .maybeSingle();
      return manager?.name ?? null;
    })(),
    mem0Key
      ? createMemoryClient(mem0Key)
          .list(orgId, employee.id, 20)
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  const { data: history } = await supabase
    .from("events")
    .select("id, channel, kind, payload, created_at")
    .eq("employee_id", id)
    .order("created_at", { ascending: false })
    .limit(30);

  const lastActionTime = history && history.length > 0 ? history[0].created_at : null;

  return (
    <main className="profile-page-v2">
      <div className="profile-container-v2">
        {/* Top Header Card */}
        <ProfileHeader
          employee={employee}
          identity={identity}
          managerName={managerName}
          assistantId={assistantId}
          lastActionTime={lastActionTime}
        />

        {/* 2-Column Balanced Grid with aligned rows */}
        <div className="profile-grid-v2">
          {/* Row 1 Left: Conversation */}
          <div className="profile-grid-cell-left-top">
            <ChatPanel
              employeeId={employee.id}
              employeeName={employee.name}
              initialPaused={Boolean(identity?.paused)}
            />
          </div>

          {/* Row 1 Right: Employee & Channels */}
          <div className="profile-grid-cell-right-top">
            {/* Employee Card (Autonomy strictly omitted per user instruction) */}
            <Card className="profile-card employee-info-card">
              <h2 className="employee-info-title">Employee</h2>
              <div className="employee-info-rows">
                <div className="employee-info-row">
                  <span className="employee-info-label">Manager</span>
                  <span className="employee-info-val">{managerName ?? "-"}</span>
                </div>
                <div className="employee-info-row">
                  <span className="employee-info-label">Role</span>
                  <span className="employee-info-val">
                    {identity?.role || "Staff Accountant"}
                  </span>
                </div>
              </div>
            </Card>

            {/* Channels Card */}
            <ChannelsCard
              employeeId={employee.id}
              emailAddress={emailAddress}
              phoneNumber={phone?.address ?? null}
              phoneStatus={phone?.status ?? null}
              phoneConnectorActive={Boolean(phoneConnector)}
              isHired={employee.hired_at !== null}
              slackDmUrl={slackDmUrl}
              slackInstallUrl={slackInstallUrl}
              slackHandle={identity?.slack_handle as string ?? null}
            />
          </div>

          {/* Row 2 Left: Activity */}
          <div className="profile-grid-cell-left-bottom">
            <ExecutionHistory
              employeeId={employee.id}
              initialHistory={history ?? []}
            />
          </div>

          {/* Row 2 Right: App Access, Memory & Danger Zone */}
          <div className="profile-grid-cell-right-bottom">
            {/* App Access Card */}
            <AccessPanel employeeId={employee.id} />

            {/* Memory Card */}
            <MemoryPanel
              employeeId={employee.id}
              firstName={employee.name.split(" ")[0]}
              initialMemories={memories as MemoryItem[] | null}
            />

            {/* Danger Zone: Fire / Remove */}
            <div className="profile-fire-wrap">
              <FireButton
                employeeId={employee.id}
                hired={employee.hired_at !== null}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
