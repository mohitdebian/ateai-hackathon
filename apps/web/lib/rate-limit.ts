import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "./supabase/server";

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export async function enforceRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
  failOpen = true,
): Promise<NextResponse | null> {
  let allowed: boolean;
  try {
    const { data, error } = await createAdminClient().rpc("check_rate_limit", {
      p_bucket: bucket,
      p_limit: limit,
      p_window: `${windowSeconds} seconds`,
    });
    if (error) throw error;
    allowed = data !== false;
  } catch (err) {
    console.error(`[rate-limit] ${bucket} check failed`, err);
    Sentry.captureException(err);
    // Fail open by default: a database blip must not lock customers out of login.
    return failOpen ? null : NextResponse.json({ error: "rate limit unavailable" }, { status: 503 });
  }

  if (!allowed) {
    return NextResponse.json(
      { error: "too many requests" },
      { status: 429, headers: { "Retry-After": String(windowSeconds) } },
    );
  }

  return null;
}
