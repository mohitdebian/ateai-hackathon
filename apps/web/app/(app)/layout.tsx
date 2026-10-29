import { getOrgName, requireOrgContext } from "../../lib/auth";
import { AppHeader } from "./app-header";
import "./app.css";

/**
 * Protected application layout. The middleware redirects unauthenticated users
 * at the edge; this call is defense-in-depth and also loads the org context
 * used to render the application header.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await requireOrgContext();
  const organizationName = await getOrgName();

  return (
    <div className="app-ui">
      <AppHeader
        organizationName={organizationName}
        userName={context.name ?? context.email ?? "User"}
      />
      {children}
    </div>
  );
}
