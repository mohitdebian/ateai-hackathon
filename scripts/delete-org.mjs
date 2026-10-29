/**
 * Cleanly delete one or all organizations, automatically tearing down external
 * AgentMail inboxes, database records, and Supabase Auth users.
 *
 * Usage:
 *   node --env-file=scripts/.env.dev scripts/delete-org.mjs <org name or id>
 *   node --env-file=scripts/.env.dev scripts/delete-org.mjs --all
 *   node --env-file=scripts/.env.dev scripts/delete-org.mjs --list
 *
 * Environment variables:
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   AGENTMAIL_API_KEY (optional, used to release remote inboxes)
 */

import fs from "node:fs";
import path from "node:path";

const [, , ...args] = process.argv;

if (!args.length || args.includes("--help") || args.includes("-h")) {
  console.log(`Usage:
  node scripts/delete-org.mjs <org name or id>
  node scripts/delete-org.mjs --all
  node scripts/delete-org.mjs --list`);
  process.exit(0);
}

const url = (
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  ""
).replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first");
  process.exit(2);
}

// Fallback lookup for AGENTMAIL_API_KEY in apps/web/.env.local or root .env
let agentmailKey = process.env.AGENTMAIL_API_KEY;
if (!agentmailKey) {
  const envCandidates = [
    path.join(process.cwd(), "apps/web/.env.local"),
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), ".env"),
  ];
  for (const candidate of envCandidates) {
    if (fs.existsSync(candidate)) {
      const match = fs.readFileSync(candidate, "utf8").match(/^AGENTMAIL_API_KEY=(.+)$/m);
      if (match) {
        agentmailKey = match[1].trim().replace(/^['"]|['"]$/g, "");
        break;
      }
    }
  }
}

async function rest(endpoint, init = {}) {
  const res = await fetch(`${url}/rest/v1/${endpoint}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${body}`);
  return body ? JSON.parse(body) : null;
}

async function authAdminDelete(userId) {
  const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    console.warn(`warning: could not delete auth user ${userId}: ${res.status} ${body}`);
  }
}

async function deleteAgentMailInbox(inboxId) {
  if (!agentmailKey) {
    console.warn(`[agentmail] skip ${inboxId}: AGENTMAIL_API_KEY not set`);
    return;
  }
  const res = await fetch(`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inboxId)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${agentmailKey}` },
  });
  if (res.ok || res.status === 404) {
    console.log(`[agentmail] deleted inbox ${inboxId}`);
  } else {
    const body = await res.text().catch(() => "");
    console.warn(`[agentmail] warning: failed to delete ${inboxId}: ${res.status} ${body}`);
  }
}

if (args[0] === "--list") {
  const orgs = await rest("organizations?select=id,name,created_at&order=created_at.desc");
  if (!orgs.length) {
    console.log("No organizations found.");
    process.exit(0);
  }
  console.log("ID\t\t\t\t\tName\t\tCreated");
  for (const o of orgs) {
    console.log(`${o.id}\t${o.name}\t${o.created_at}`);
  }
  process.exit(0);
}

let targetOrgs = [];

if (args[0] === "--all") {
  targetOrgs = await rest("organizations?select=id,name");
  if (!targetOrgs.length) {
    console.log("No organizations to delete.");
    process.exit(0);
  }
  console.log(`Found ${targetOrgs.length} organization(s) to delete.`);
} else {
  const target = args[0];
  const column = /^[0-9a-f-]{36}$/i.test(target) ? "id" : "name";
  targetOrgs = await rest(`organizations?select=id,name&${column}=eq.${encodeURIComponent(target)}`);
  if (!targetOrgs.length) {
    console.error(`No organization matching "${target}"`);
    process.exit(1);
  }
}

for (const org of targetOrgs) {
  console.log(`\nDeleting organization "${org.name}" (${org.id})...`);

  // 1. Fetch connectors and employees
  const [connectors, employees, users] = await Promise.all([
    rest(`employee_connectors?org_id=eq.${org.id}&select=*`),
    rest(`employees?org_id=eq.${org.id}&select=id,name,email_address,identity`),
    rest(`users?org_id=eq.${org.id}&select=id,email`),
  ]);

  // 2. Collect all AgentMail inboxes
  const inboxes = new Set();
  for (const c of connectors ?? []) {
    if (c.provider === "agentmail" && c.address) inboxes.add(c.address);
    if (c.address && c.address.endsWith("@agentmail.to")) inboxes.add(c.address);
  }
  for (const e of employees ?? []) {
    if (e.email_address && e.email_address.endsWith("@agentmail.to")) inboxes.add(e.email_address);
    if (e.identity?.email_address && e.identity.email_address.endsWith("@agentmail.to")) {
      inboxes.add(e.identity.email_address);
    }
  }

  // 3. Delete remote AgentMail inboxes
  if (inboxes.size > 0) {
    console.log(`Found ${inboxes.size} AgentMail inbox(es) to delete:`);
    for (const inbox of inboxes) {
      await deleteAgentMailInbox(inbox);
    }
  } else {
    console.log("No AgentMail inboxes associated with this org.");
  }

  // 4. Delete the organization from PostgreSQL (cascades)
  await rest(`organizations?id=eq.${org.id}`, { method: "DELETE" });
  console.log(`Deleted organization row from database (cascaded).`);

  // 5. Delete auth users
  for (const u of users ?? []) {
    await authAdminDelete(u.id);
    console.log(`Deleted auth user ${u.email ?? u.id}`);
  }

  console.log(`Organization "${org.name}" fully deleted.`);
}

console.log("\nDone.");
