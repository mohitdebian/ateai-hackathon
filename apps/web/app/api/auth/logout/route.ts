import { NextResponse } from "next/server";
import { createClient } from "../../../../lib/supabase/server";

export const runtime = "nodejs";

/**
 * Server-side sign out. POST only — a GET handler here gets executed by
 * next/link prefetch in production, which destroyed fresh sessions right
 * after login (cookie wiped + refresh token revoked).
 */
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
