import { NextResponse } from "next/server";
import { dispatchHeartbeat } from "../../../../lib/worker";

export const runtime = "nodejs";

/**
 * Vercel Cron handler for employee check-ins.
 * Invoked by Vercel's scheduler on schedule "0 9,13,17 * * 1-5" (Mon-Fri).
 * Secured by CRON_SECRET if configured.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new NextResponse("unauthorized", { status: 401 });
    }
  }

  try {
    await dispatchHeartbeat();
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/heartbeat] failed", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
