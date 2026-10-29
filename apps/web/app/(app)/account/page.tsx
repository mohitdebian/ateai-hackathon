import Link from "next/link";
import { Avatar } from "../../../lib/avatar";
import { getOrgName, requireOrgContext } from "../../../lib/auth";
import { createClient } from "../../../lib/supabase/server";
import { DeleteOrgButton } from "./delete-org-button";

export default async function AccountPage() {
  const context = await requireOrgContext();
  // Cached, and the app layout above already awaited it — free here.
  const organizationName = await getOrgName();
  const supabase = await createClient();
  const { data: memberships, error: membershipsError } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("org_id", context.orgId);

  if (membershipsError) {
    throw new Error("Could not load account details");
  }

  const memberIds = memberships.map((membership) => membership.user_id);
  const { data: people, error: peopleError } = memberIds.length
    ? await supabase.from("users").select("id, name, email").in("id", memberIds)
    : { data: [], error: null };

  if (peopleError) throw new Error("Could not load organization members");

  const peopleById = new Map(people.map((person) => [person.id, person]));
  const members = memberships.map((membership) => ({
    ...membership,
    person: peopleById.get(membership.user_id),
  }));
  const displayName = context.name ?? context.email ?? "User";

  return (
    <main className="account-page">
      <div className="account-layout">
        <aside className="account-sidebar">
          <div className="account-person">
            <Avatar name={displayName} />
            <div>
              <strong>{displayName}</strong>
              <span>{context.email}</span>
            </div>
          </div>
          <Link href="/logout" className="account-logout">
            Log out
          </Link>
        </aside>

        <section className="account-main">
          <h1>{organizationName}</h1>
          <p>Members with access to this organization.</p>
          <div className="member-list">
            {members.map(({ user_id, role, person }) => {
              const name = person?.name ?? person?.email ?? "Member";
              return (
                <div className="member-row" key={user_id}>
                  <div className="member-person">
                    <Avatar name={name} />
                    <div>
                      <strong>
                        {name}
                        {user_id === context.userId ? " (you)" : ""}
                      </strong>
                      <span>{person?.email}</span>
                    </div>
                  </div>
                  <span className="member-role">{role}</span>
                </div>
              );
            })}
          </div>

          {context.role === "admin" && (
            <div style={{ marginTop: 48, borderTop: "1px solid var(--border, #333)", paddingTop: 24 }}>
              <h2 style={{ fontSize: 16, color: "var(--red, #e5484d)", margin: "0 0 8px" }}>Danger Zone</h2>
              <p style={{ fontSize: 14, opacity: 0.8, margin: "0 0 16px" }}>
                Permanently delete this organization, all its employees, and release all associated email inboxes.
              </p>
              <DeleteOrgButton orgName={organizationName} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
