import Link from "next/link";
import { requireOrgContext } from "../../../lib/auth";
import { createAdminClient, createClient } from "../../../lib/supabase/server";
import { OrgCanvas, type Emp, type Human } from "./org-canvas";
import { ActivityRail } from "./activity-rail";

export default async function DashboardPage() {
  const { orgId } = await requireOrgContext();
  const supabase = await createClient();
  const admin = createAdminClient();

  // Unhired rows (mid-wizard, or a hire that failed and awaits retry/discard)
  // are not employees yet — the org chart shows only the real workforce (#108).
  const [{ data: employees }, { data: members }, { data: connectors }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, name, manager_id, identity")
      .not("hired_at", "is", null),
    supabase.from("users").select("id, name"),
    admin
      .from("employee_connectors")
      .select("employee_id, provider, address, status")
      .eq("org_id", orgId),
  ]);

  const humans: Human[] = (members ?? []).map((m) => ({
    id: m.id,
    name: m.name ?? "Admin",
  }));
  const emps: Emp[] = (employees ?? []).map((e) => {
    const empConnectors = (connectors ?? []).filter((c) => c.employee_id === e.id);
    const hasEmail =
      empConnectors.some(
        (c) =>
          (c.provider === "agentmail" || c.provider === "email") &&
          c.status === "active" &&
          Boolean(c.address),
      ) || Boolean(e.identity?.email_address);

    const hasSlack =
      empConnectors.some(
        (c) => c.provider === "slack" && c.status === "active",
      ) || Boolean(e.identity?.slack_handle);

    const hasPhone =
      empConnectors.some(
        (c) =>
          c.provider === "vapi_phone" &&
          c.status === "active" &&
          Boolean(c.address),
      ) || Boolean(e.identity?.phone_number);

    return {
      id: e.id,
      name: e.name,
      manager_id: e.manager_id,
      role: e.identity?.role ?? "",
      scope: e.identity?.scope_of_work ?? "",
      channels: {
        email: hasEmail,
        slack: hasSlack,
        phone: hasPhone,
      },
    };
  });

  return (
    <main className="dashboard-page">
      <div className="dashboard-canvas">
        <OrgCanvas humans={humans} employees={emps} />
      </div>
      <ActivityRail />
      <Link href="/employees/new" className="btn btn-blue dashboard-hire">
        Hire
      </Link>
    </main>
  );
}
