import type { Counterparty, IdentityFile } from "@ate/shared";
import { createAdminClient, logDegraded } from "./supabase.js";
import { loadEmployee, recentMessages } from "./employee.js";
import { listDocuments } from "./knowledge.js";
import { buildDeps } from "./deps.js";
import { buildSystemPrompt } from "./prompt.js";
import { activeProvidersFor } from "./tools.js";

/**
 * Assemble the system prompt injected into a Vapi call at call start (#119) —
 * the same identity + memory + knowledge + recent-conversation assembly a turn
 * gets, rebuilt per call instead of frozen at hire. The call itself runs on
 * Vapi's own LLM; one transcript turn runs after it ends.
 */

export interface ContextRequest {
  org_id: string;
  employee_id: string;
  counterparty?: Counterparty;
}

export function isContextRequest(body: unknown): body is ContextRequest {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b.org_id === "string" && typeof b.employee_id === "string";
}

const RECALL_LIMIT = 20;

/**
 * No utterance exists at call start, so knowledge is retrieved against the
 * employee's own job description — the best proxy for what its calls are about.
 */
export function knowledgeQuery(identity: IdentityFile): string {
  return [identity.role, identity.scope_of_work, ...(identity.daily_responsibilities ?? [])]
    .filter(Boolean)
    .join("\n");
}

export async function buildCallContext(req: ContextRequest): Promise<string> {
  const admin = createAdminClient();
  const deps = buildDeps(admin);

  const employee = await loadEmployee(admin, req.org_id, req.employee_id);
  if (!employee) throw new Error(`employee ${req.employee_id} not found in org ${req.org_id}`);

  const envelope = { org_id: req.org_id, employee_id: req.employee_id, channel: "voice" as const, text: "" };
  const query = knowledgeQuery(employee.identity);
  const [memories, chunks, recent, documents, connectors] = await Promise.all([
    deps.memory
      .list(req.org_id, req.employee_id, RECALL_LIMIT)
      .catch(async (err: unknown) => (await logDegraded(envelope, "recall", err), [] as { memory: string }[])),
    query
      ? deps.knowledge
          .retrieve(req.org_id, req.employee_id, query)
          .catch(async (err: unknown) => (await logDegraded(envelope, "knowledge", err), []))
      : [],
    recentMessages(admin, req.org_id, req.employee_id, "voice", req.counterparty).catch(
      async (err: unknown) => (await logDegraded(envelope, "recent", err), []),
    ),
    listDocuments(admin, req.org_id, req.employee_id).catch(
      async (err: unknown) => (await logDegraded(envelope, "documents", err), null),
    ),
    // #309
    activeProvidersFor(admin, req.org_id, req.employee_id).catch(
      async (err: unknown) => (await logDegraded(envelope, "connectors", err), null),
    ),
  ]);

  return buildSystemPrompt(
    employee,
    memories.map((m) => m.memory),
    chunks,
    recent,
    req.counterparty,
    "voice-live",
    documents,
    connectors,
  );
}
