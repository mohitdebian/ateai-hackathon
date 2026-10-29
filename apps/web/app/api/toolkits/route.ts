import { NextResponse } from "next/server";
import { getOrgContext } from "../../../lib/auth";
import { composio } from "../../../lib/composio";
import { hasEnv } from "../../../lib/env";

export const runtime = "nodejs";

/**
 * The catalog behind the grant-access dropdown (#42) — everything Composio can
 * connect, so people can search instead of guessing a slug.
 *
 * The catalog outgrows the API's 1000-per-page ceiling, and the SDK's
 * `toolkits.get()` drops `next_cursor`, so this pages through the raw client.
 *
 * The catalog is global rather than per-org, so it is cached process-wide and
 * shared across tenants — no org data passes through here.
 */

export interface Toolkit {
  slug: string;
  name: string;
  logo?: string;
}

const CATALOG_LIMIT = 1000;
/** ponytail: cached for the process lifetime; add a TTL if new toolkits need to appear without a redeploy. */
let cache: Toolkit[] | null = null;

export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!hasEnv("COMPOSIO_API_KEY")) {
    return NextResponse.json({ configured: false, toolkits: [] });
  }

  if (!cache) {
    try {
      const all: Toolkit[] = [];
      let cursor: string | undefined;
      do {
        const page = await composio().getClient().toolkits.list({ limit: CATALOG_LIMIT, cursor }, { signal: AbortSignal.timeout(30_000) });
        all.push(...page.items.map((t) => ({ slug: t.slug, name: t.name, logo: t.meta?.logo })));
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      cache = all;
    } catch (err) {
      console.error("[toolkits] catalog fetch failed", err);
      // The panel still works without it: its free-text fallback accepts any slug.
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "could not load toolkits" },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ configured: true, toolkits: cache });
}
