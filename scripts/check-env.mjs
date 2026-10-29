/**
 * Fails when a required env var is missing from the environment a merge ships
 * to, so the merge blocks instead of the var surfacing as a runtime throw from
 * `must()` on the first request that needs it (#238).
 *
 * Presence only — values are never read or printed, so secrets stay out of CI
 * logs. Reads the required names from required-env.json (deliberately not from
 * .env.example, which also lists optional vars).
 *
 * Usage: node scripts/check-env.mjs <production|development>
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const target = process.argv[2];
if (target !== "production" && target !== "development") {
  console.error("usage: check-env.mjs <production|development>");
  process.exit(2);
}

// Vercel calls the non-production scope "preview"; Cloud Run services and the
// GCP-side naming use "-dev". One target name, two vendor spellings.
const vercelScope = target === "production" ? "production" : "preview";
const workerService = target === "production" ? "ate-worker-prod" : "ate-worker-dev";

// One Vercel project serves both environments (docs/architecture.md); the scope
// above is what separates them. Override only if the project is ever renamed.
const VERCEL_PROJECT = process.env.VERCEL_PROJECT_NAME ?? "digital-workforce";

const required = JSON.parse(readFileSync(new URL("./required-env.json", import.meta.url)));

/** Names set on the Vercel project for one scope. */
function vercelNames() {
  // `vercel env ls <scope>` prints a table; the name is the first column of
  // rows after the header. --token comes from the VERCEL_TOKEN env var.
  //
  // --scope/--project are required in CI: the link normally lives in .vercel/,
  // which is gitignored, so a runner has no project to resolve against and the
  // CLI exits with "codebase isn't linked to a project".
  // Pinned: --project landed after 53.x, and an unpinned npx would silently
  // change behaviour under CI.
  const args = ["-y", "vercel@59.6.2", "env", "ls", vercelScope, "--project", VERCEL_PROJECT];
  if (process.env.VERCEL_ORG_ID) args.push("--scope", process.env.VERCEL_ORG_ID);
  const out = execFileSync("npx", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const names = new Set(
    out
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((name) => /^[A-Z][A-Z0-9_]*$/.test(name)),
  );
  // An empty list means the CLI listed nothing — a bad token or wrong project,
  // not a project with zero vars. Reporting "everything is missing" would hide
  // that, so fail on the real cause instead.
  if (names.size === 0) {
    console.error(`vercel env ls ${vercelScope} returned no variables — check VERCEL_TOKEN and the linked project.`);
    process.exit(2);
  }
  return names;
}

/** Names set on the Cloud Run worker service. */
function workerNames() {
  const out = execFileSync(
    "gcloud",
    [
      "run",
      "services",
      "describe",
      workerService,
      "--region",
      "us-central1",
      // `env[].name` prints names only. The `.list(show='key')` projection
      // prints values too, which would leak every secret into the CI log.
      "--format",
      "value(spec.template.spec.containers[0].env[].name)",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const names = new Set(
    out
      .split(/[;,\s]+/)
      .map((name) => name.trim())
      .filter(Boolean),
  );
  // As above: no names means the describe call did not return a container env,
  // which is a lookup problem rather than a service with nothing set.
  if (names.size === 0) {
    console.error(`No env vars read from ${workerService} — check the service name and GCP credentials.`);
    process.exit(2);
  }
  return names;
}

const missing = [];

for (const [label, names, actual] of [
  [`Vercel (${vercelScope})`, required.vercel, vercelNames()],
  [`Cloud Run (${workerService})`, required.worker, workerNames()],
]) {
  for (const entry of names) {
    // An array means "any one of these satisfies it" — the worker reads
    // SUPABASE_URL but falls back to NEXT_PUBLIC_SUPABASE_URL (worker env.ts).
    const accepted = Array.isArray(entry) ? entry : [entry];
    if (!accepted.some((name) => actual.has(name))) {
      missing.push(`${label}: ${accepted.join(" or ")}`);
    }
  }
}

if (missing.length > 0) {
  console.error(`Missing required env vars for the ${target} environment:\n`);
  for (const line of missing) console.error(`  ${line}`);
  console.error(`\nSet each one, then re-run this check. Names come from scripts/required-env.json.`);
  process.exit(1);
}

console.log(`All required env vars are set for ${target}.`);
