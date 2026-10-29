import { redirect } from "next/navigation";
import { getOrgContext } from "../lib/auth";

/**
 * Root doorway ("/") redirecting authenticated users to the dashboard
 * and unauthenticated visitors to login.
 */
export default async function RootPage() {
  const ctx = await getOrgContext();
  redirect(ctx ? "/dashboard" : "/login");
}
