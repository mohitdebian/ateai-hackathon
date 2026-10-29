/**
 * Seam interfaces — the boundaries a worker turn depends on
 * (docs/architecture.md "The seams").
 * Real signatures, stub bodies. Developers build the real implementations
 * behind these; the worker only ever depends on the interface.
 *
 * IMPORTANT: changing a signature here requires lead sign-off —
 * every consumer depends on these shapes. See CONVENTIONS.md.
 */
import type { Channel } from "./envelope.js";
import type { IdentityFile } from "./identity.js";

/** Mem0-backed recall: searched before a turn, written after. */
export interface MemoryClient {
  /** Relevant recall for this employee, scoped by employee_id-as-agent. */
  search(orgId: string, employeeId: string, query: string): Promise<string[]>;
  /** Persist newly extracted memories after a turn. */
  write(orgId: string, employeeId: string, messages: MemoryMessage[]): Promise<void>;
  /** All stored memories for this employee, newest first — the profile page's Memories section. */
  list(orgId: string, employeeId: string, limit: number): Promise<Memory[]>;
}

export interface MemoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Memory {
  id: string;
  memory: string;
  created_at: string;
}

/** pgvector-backed semantic knowledge retrieval at turn start. */
export interface KnowledgeRetriever {
  retrieve(
    orgId: string,
    employeeId: string,
    query: string,
    limit?: number,
  ): Promise<KnowledgeChunk[]>;
}

export interface KnowledgeChunk {
  doc_id: string;
  title: string;
  content: string;
  score: number;
}

/** Append-only action log — the `events` table, which also powers the dashboard (docs/data-model.md "Event payloads"). */
export interface EventLogger {
  append(event: EventInput): Promise<void>;
}

export interface EventInput {
  org_id: string;
  employee_id: string;
  channel: Channel;
  kind: "message" | "tool" | "subagent";
  payload: Record<string, unknown>;
}

// --- Stub implementations (fake bodies; replaced in F/T1) -------------------

export const stubMemoryClient: MemoryClient = {
  async search() {
    return [];
  },
  async write() {},
  async list() {
    return [];
  },
};

export const stubKnowledgeRetriever: KnowledgeRetriever = {
  async retrieve() {
    return [];
  },
};

export const stubEventLogger: EventLogger = {
  async append(event) {
    console.log("[event]", event.kind, event.employee_id);
  },
};

/** The identity an employee turn loads; re-exported for convenience. */
export type { IdentityFile };
