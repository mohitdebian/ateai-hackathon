import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import type { Database } from "@ate/shared";
import { supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey } from "../env";

/**
 * Server Supabase client bound to the request's auth cookies or Bearer token (anon key, RLS
 * enforced). Use in server components, route handlers, and server actions.
 */
export async function createClient() {
  try {
    const headerList = await headers();
    const authHeader = headerList.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return createServiceClient<Database>(supabaseUrl(), supabaseAnonKey(), {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      });
    }
  } catch {
    // In contexts where headers() is unavailable (e.g. background tasks)
  }

  const cookieStore = await cookies();
  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        try {
          const prod = process.env.NODE_ENV === "production";
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, {
              ...options,
              ...(prod ? { secure: true } : {}),
            });
          }
        } catch {
          // Called from a Server Component where cookies are read-only; the
          // middleware refreshes the session cookie instead. Safe to ignore.
        }
      },
    },
  });
}

/**
 * Service-role client — bypasses RLS. Server-only, for the worker/provisioning
 * paths that must write across the tenant boundary. It is the caller's job to
 * scope every query by org_id (docs/data-model.md "Tenancy / RLS").
 */
export function createAdminClient() {
  return createServiceClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
