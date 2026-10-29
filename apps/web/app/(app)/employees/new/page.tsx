import { requireOrgContext } from "../../../../lib/auth";
import { createClient } from "../../../../lib/supabase/server";
import { NewEmployeeWizard } from "./new-wizard";

// Auth is enforced by the middleware and the (app) layout; no page-level gate.
// The heading lives in the wizard — the run is several steps and the copy moves
// with it, which only the client component knows about (#38).
//
// The manager is always the hirer — only humans can manage (#201). No picker,
// just their name to show on the describe step.
export default async function NewEmployeePage() {
  const ctx = await requireOrgContext();
  const supabase = await createClient();

  const { data: me } = await supabase
    .from("users")
    .select("name, email")
    .eq("id", ctx.userId)
    .maybeSingle();

  return <NewEmployeeWizard managerName={me?.name ?? me?.email ?? "You"} />;
}
