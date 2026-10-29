import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { MembershipRole } from "@ate/shared";
import { createClient, createAdminClient } from "./supabase/server";

export interface OrgContext {
  userId: string;
  orgId: string;
  role: MembershipRole;
  name: string | null;
  email: string | null;
}

export function isPrivileged(role: MembershipRole): boolean {
  return role === "admin" || role === "manager";
}

/**
 * Resolve the signed-in user's org context, or null when unauthenticated /
 * not attached to an org. Use in route handlers (return 401 on null).
 *
 * Wrapped in React `cache()` so the layout's call and a page's call within
 * the same request share one result instead of re-running 3 Supabase
 * queries twice per navigation.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  try {
    let user = null;
    let client: ReturnType<typeof createAdminClient> | Awaited<ReturnType<typeof createClient>> | null = null;

    try {
      const headerList = await headers();
      const authHeader = headerList.get("authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice(7).trim();
        const admin = createAdminClient();
        const { data } = await admin.auth.getUser(token);
        if (data?.user) {
          user = data.user;
          client = admin;
        }
      }
    } catch {
      // In contexts where headers() is unavailable
    }

    if (!user) {
      const supabase = await createClient();
      const {
        data: { user: cookieUser },
      } = await supabase.auth.getUser();
      user = cookieUser;
      client = supabase;
    }

    if (!user || !client) {
      console.warn("[auth] getOrgContext: no user on this request");
      return null;
    }

    const [{ data: profile }, { data: membership }] = await Promise.all([
      client
        .from("users")
        .select("org_id, name, email")
        .eq("id", user.id)
        .single(),
      client
        .from("memberships")
        .select("org_id, role")
        .eq("user_id", user.id)
        .limit(1)
        .single(),
    ]);

    if (!profile || !membership) {
      console.warn("[auth] getOrgContext: authed but missing rows", {
        userId: user.id,
        hasProfile: !!profile,
        hasMembership: !!membership,
      });
      return null;
    }

    return {
      userId: user.id,
      orgId: membership.org_id,
      role: membership.role,
      name: profile.name,
      email: profile.email || user.email || null,
    };
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "digest" in err &&
      (err as { digest?: string }).digest === "DYNAMIC_SERVER_USAGE"
    ) {
      throw err;
    }
    console.warn("[auth] getOrgContext: unable to resolve session:", err);
    return null;
  }
});

/**
 * Like getOrgContext but redirects to /login when absent. Use in server
 * components / pages — the single source of truth for "who is calling".
 */
export async function requireOrgContext(): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/**
 * The signed-in user's organization name, for display. Cached like
 * getOrgContext, so the app layout's header and a page that also shows the
 * name share one query per request rather than issuing two.
 *
 * Never throws: this is a label. A failed lookup renders the fallback instead
 * of taking down every page under the app layout.
 */
export const getOrgName = cache(async (): Promise<string> => {
  const ctx = await getOrgContext();
  if (!ctx) return "Organization";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", ctx.orgId)
    .maybeSingle();

  if (error) console.warn("[auth] getOrgName failed", error.message);
  return data?.name ?? "Organization";
});
