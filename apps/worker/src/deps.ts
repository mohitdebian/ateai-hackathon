import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MemoryClient, KnowledgeRetriever } from "@ate/shared";
import { createMemoryClient } from "@ate/shared";
import { createKnowledgeRetriever } from "./knowledge.js";

/**
 * The seam implementations a turn depends on (docs/architecture.md "The
 * seams"), assembled from what's configured: memory → Mem0, knowledge →
 * pgvector retrieval. runTurn only ever depends on the interfaces.
 */
export interface TurnDeps {
  memory: MemoryClient;
  knowledge: KnowledgeRetriever;
}

export function buildDeps(admin: SupabaseClient<Database>): TurnDeps {
  return {
    memory: createMemoryClient(process.env.MEM0_API_KEY),
    knowledge: createKnowledgeRetriever(admin, process.env.VOYAGE_API_KEY),
  };
}
