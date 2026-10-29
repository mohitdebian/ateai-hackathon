import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { Database } from "@ate/shared";
import { supabaseUrl, supabaseAnonKey } from "../../../../lib/env";
import { clientIp, enforceRateLimit } from "../../../../lib/rate-limit";

export const runtime = "nodejs";

/**
 * Server-side sign in. Session cookies are written directly onto the response
 * we return, so the Set-Cookie headers carry exactly the attributes set below.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(`login:${clientIp(request)}`, 10, 15 * 60);
  if (limited) return limited;

  const { email, password } = await request.json();
  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const response = NextResponse.json({ ok: true });

  const supabase = createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) }) },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        for (const { name, value, options } of cookiesToSet) {
          // Secure on production HTTPS; localhost HTTP keeps the plain default.
          // SameSite stays Lax (Supabase default) — correct for a first-party app.
          const prod = process.env.NODE_ENV === "production";
          response.cookies.set(name, value, {
            ...options,
            ...(prod ? { secure: true } : {}),
          });
        }
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return response; // carries the Set-Cookie header(s)
}
