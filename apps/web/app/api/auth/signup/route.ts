import { NextResponse } from "next/server";
import { DEFAULT_ORG_PROVIDERS } from "@ate/shared";
import { createAdminClient } from "../../../../lib/supabase/server";
import { clientIp, enforceRateLimit } from "../../../../lib/rate-limit";

/**
 * Org signup — the first user in an org becomes its admin. Runs with the
 * service role so it can create the auth user and bootstrap the org, profile,
 * and admin membership in one deterministic step — no email-confirmation race.
 * The client signs in afterward with the same credentials.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(`signup:${clientIp(request)}`, 3, 60 * 60);
  if (limited) return limited;

  const { email, password, org_name, full_name } = await request.json();

  if (!email || !password || !org_name) {
    return NextResponse.json(
      { error: "email, password, and org_name are required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (createError || !created.user) {
    return NextResponse.json(
      { error: createError?.message ?? "Could not create user" },
      { status: 400 },
    );
  }

  const userId = created.user.id;

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: org_name })
    .select("id")
    .single();
  if (orgError || !org) {
    // Roll back the auth user so a retry with the same email can succeed.
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json(
      { error: orgError?.message ?? "Could not create organization" },
      { status: 400 },
    );
  }

  const { error: profileError } = await admin.from("users").insert({
    id: userId,
    org_id: org.id,
    name: full_name ?? null,
    email,
  });
  const { error: membershipError } = await admin.from("memberships").insert({
    user_id: userId,
    org_id: org.id,
    role: "admin",
  });

  // What this client has turned on (#250). Every new org starts with the three
  // connectors hire provisions — not phone numbers, which cost money and are
  // turned on per client (#252). Choosing the rest per client is #243. Not
  // fatal — a missing row costs that connector at hire, not the account, and
  // re-seeding is one insert.
  const { error: connectorError } = await admin
    .from("org_connectors")
    .insert(DEFAULT_ORG_PROVIDERS.map((provider) => ({ org_id: org.id, provider })));
  if (connectorError) {
    console.error("[signup] could not seed org connectors", connectorError);
  }

  if (profileError || membershipError) {
    await admin.auth.admin.deleteUser(userId);
    await admin.from("organizations").delete().eq("id", org.id);
    return NextResponse.json(
      { error: (profileError ?? membershipError)?.message ?? "Signup failed" },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
